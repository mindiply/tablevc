import {
  createInMemoryVTChannel,
  Id,
  createVersionedTable,
  push,
  pull
} from '../src';

interface TstRecordType {
  _id: Id;
  name: string;
  when: Date;
  amount: number;
  children: Id[];
  isTrue: boolean;
}

let idCount = 0;
const emptyTestRecord = (): TstRecordType => ({
  _id: `ID_${idCount++}`,
  amount: idCount,
  children: [],
  isTrue: true,
  name: '',
  when: new Date()
});

describe('Clone from server', () => {
  test('Empty history', async () => {
    const serverHistory = await createVersionedTable<TstRecordType>({
      primaryKey: '_id',
      tableName: 'Tst'
    });
    const channel = createInMemoryVTChannel(serverHistory);
    const {lastCommitId, rows} = await channel.cloneTable(
      serverHistory.tbl.tableName
    );
    expect(rows.length).toBe(0);
    expect(lastCommitId).toBe(serverHistory.lastCommitId());
  });

  test('A few records', async () => {
    const serverHistory = await createVersionedTable<TstRecordType>({
      primaryKey: '_id',
      tableName: 'Tst'
    });
    const testRecord = {
      ...emptyTestRecord(),
      _id: 'TEST1'
    };
    await serverHistory.addRecord('TEST1', testRecord);
    await serverHistory.addRecord('TEST2', {
      ...testRecord,
      _id: 'TEST2',
      name: 'Test2'
    });
    const channel = createInMemoryVTChannel(serverHistory);
    const {lastCommitId, rows} = await channel.cloneTable(
      serverHistory.tbl.tableName
    );
    expect(rows.length).toBe(2);
    expect(lastCommitId).toBe(serverHistory.lastCommitId());
    expect(rows[0]).toEqual(serverHistory.syncTbl!.syncGetRecord('TEST1')!);
  });
});

describe('Push', () => {
  test('Perform not conflicting synchronization', async () => {
    const testRecord = {
      ...emptyTestRecord(),
      _id: 'TEST1'
    };
    const testRecord2 = {
      ...emptyTestRecord(),
      _id: 'TEST2'
    };
    const h1 = await createVersionedTable<TstRecordType>({
      primaryKey: '_id',
      tableName: 'Tst'
    });
    const channel = createInMemoryVTChannel(h1);
    const {lastCommitId, rows} = await channel.cloneTable<TstRecordType>('Tst');
    const h2 = await createVersionedTable<TstRecordType>({
      tableName: 'Tst',
      primaryKey: '_id',
      initialData: {
        commitId: lastCommitId,
        data: rows
      }
    });
    await h1.addRecord(testRecord._id, testRecord);
    await h2.addRecord(testRecord2._id, testRecord2);
    await push(h2, channel);

    expect(h1.syncTbl!.syncSize()).toBe(2);
    expect(h1.syncTbl!.syncGetRecord('TEST1')).toEqual(testRecord);
    expect(h1.syncTbl!.syncGetRecord('TEST2')).toEqual(testRecord2);
    expect(h2.syncTbl!.syncSize()).toBe(2);
    expect(h2.syncTbl!.syncGetRecord('TEST1')).toEqual(testRecord);
    expect(h2.syncTbl!.syncGetRecord('TEST2')).toEqual(testRecord2);
  });

  test('Perform conflicting concurrent synchronization - change vs delete', async () => {
    const testRecord = {
      ...emptyTestRecord(),
      _id: 'TEST1'
    };
    const testRecord2 = {
      ...emptyTestRecord(),
      _id: 'TEST2'
    };
    const h1 = await createVersionedTable<TstRecordType>({
      primaryKey: '_id',
      tableName: 'Tst'
    });
    await h1.addRecord(testRecord._id, testRecord);
    const channel = createInMemoryVTChannel(h1);
    const {lastCommitId, rows} = await channel.cloneTable<TstRecordType>('Tst');
    const h2 = await createVersionedTable<TstRecordType>({
      tableName: 'Tst',
      primaryKey: '_id',
      initialData: {
        commitId: lastCommitId,
        data: rows
      }
    });
    await h2.addRecord(testRecord2._id, testRecord2);
    await h2.deleteRecord(testRecord._id);
    await h1.updateRecord(testRecord._id, {amount: 251177});
    await push(h2, channel);

    expect(h1.syncTbl!.syncSize()).toBe(2);
    expect(h1.syncTbl!.syncGetRecord('TEST1')).toEqual({
      ...testRecord,
      amount: 251177
    });
    expect(h1.syncTbl!.syncGetRecord('TEST2')).toEqual(testRecord2);
    expect(h2.syncTbl!.syncSize()).toBe(2);
    expect(h2.syncTbl!.syncGetRecord('TEST1')).toEqual({
      ...testRecord,
      amount: 251177
    });
    expect(h2.syncTbl!.syncGetRecord('TEST2')).toEqual(testRecord2);
  });
});

describe('Pull', () => {
  test('Null no changes pull', async () => {
    const h1 = await createVersionedTable<TstRecordType>({
      primaryKey: '_id',
      tableName: 'Tst'
    });
    const channel = createInMemoryVTChannel(h1);
    const {lastCommitId, rows} = await channel.cloneTable<TstRecordType>('Tst');
    const h2 = await createVersionedTable<TstRecordType>({
      tableName: 'Tst',
      primaryKey: '_id',
      initialData: {
        commitId: lastCommitId,
        data: rows
      }
    });
    await pull(h2, channel);
    expect(h2.lastCommitId()).toBe(h1.lastCommitId());
    expect(h2.syncTbl!.syncSize()).toBe(0);
  });

  test('Some changes to pull', async () => {
    const h1 = await createVersionedTable<TstRecordType>({
      primaryKey: '_id',
      tableName: 'Tst'
    });
    const channel = createInMemoryVTChannel(h1);
    const {lastCommitId, rows} = await channel.cloneTable<TstRecordType>('Tst');
    const h2 = await createVersionedTable<TstRecordType>({
      tableName: 'Tst',
      primaryKey: '_id',
      initialData: {
        commitId: lastCommitId,
        data: rows
      }
    });
    const testRecord = {
      ...emptyTestRecord(),
      _id: 'TEST1'
    };
    const testRecord2 = {
      ...emptyTestRecord(),
      _id: 'TEST2'
    };
    await h1.addRecord(testRecord);
    await h1.addRecord(testRecord2);
    await pull(h2, channel);
    expect(h2.lastCommitId()).toBe(h1.lastCommitId());
    expect(h2.syncTbl!.syncSize()).toBe(2);
    expect(h2.syncTbl!.syncGetRecord('TEST1')!).toEqual(
      h1.syncTbl!.syncGetRecord('TEST1')!
    );
  });
});
