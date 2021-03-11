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

const tstRecord = (id: Id): TstRecordType => ({...emptyTestRecord(), _id: id});

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

  test('Psuh with cancelled merge', async () => {
    const testRecord = {
      ...emptyTestRecord(),
      _id: 'TEST1'
    };
    const testRecord2 = {
      ...emptyTestRecord(),
      _id: 'TEST2'
    };
    const server = await createVersionedTable<TstRecordType>({
      primaryKey: '_id',
      tableName: 'Tst'
    });
    const channel = createInMemoryVTChannel(server);
    const {lastCommitId, rows} = await channel.cloneTable<TstRecordType>('Tst');
    const client = await createVersionedTable<TstRecordType>({
      tableName: 'Tst',
      primaryKey: '_id',
      initialData: {
        commitId: lastCommitId,
        data: rows
      }
    });
    await server.addRecord(testRecord._id, testRecord);
    await client.addRecord(testRecord2._id, testRecord2);
    await push(client, channel, () => true);

    expect(server.syncTbl!.syncSize()).toBe(2);
    expect(server.syncTbl!.syncGetRecord('TEST1')).toEqual(testRecord);
    expect(server.syncTbl!.syncGetRecord('TEST2')).toEqual(testRecord2);
    expect(client.syncTbl!.syncSize()).toBe(1);
    expect(client.syncTbl!.syncGetRecord('TEST1')).toBe(undefined);
    expect(client.syncTbl!.syncGetRecord('TEST2')).toEqual(testRecord2);
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

  test('Changes from other client to pull', async () => {
    const server = await createVersionedTable<TstRecordType>({
      primaryKey: '_id',
      tableName: 'Tst'
    });
    const channel = createInMemoryVTChannel(server);
    const {lastCommitId, rows} = await channel.cloneTable<TstRecordType>('Tst');
    const client1 = await createVersionedTable<TstRecordType>({
      tableName: 'Tst',
      primaryKey: '_id',
      initialData: {
        commitId: lastCommitId,
        data: rows
      }
    });
    const client2 = await createVersionedTable<TstRecordType>({
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
    await client1.addRecord(testRecord);
    await push(client1, channel);
    await pull(client2, channel);
    await client2.updateRecord('TEST1', {amount: 998});
    await push(client2, channel);
    await pull(client1, channel);
    expect(client1.syncTbl!.syncSize()).toBe(1);
    expect(client2.syncTbl!.syncSize()).toBe(1);
    expect(client1.syncTbl!.syncGetRecord('TEST1')).toEqual(
      client2.syncTbl!.syncGetRecord('TEST1')
    );
  });

  test('Cancelled merge pull', async () => {
    const server = await createVersionedTable<TstRecordType>({
      primaryKey: '_id',
      tableName: 'Tst'
    });
    const channel = createInMemoryVTChannel(server);
    const {lastCommitId, rows} = await channel.cloneTable<TstRecordType>('Tst');
    const client1 = await createVersionedTable<TstRecordType>({
      tableName: 'Tst',
      primaryKey: '_id',
      initialData: {
        commitId: lastCommitId,
        data: rows
      }
    });
    const client2 = await createVersionedTable<TstRecordType>({
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
    await client1.addRecord(testRecord);
    await push(client1, channel);
    await pull(client2, channel);
    await client2.updateRecord('TEST1', {amount: 998});
    await push(client2, channel);
    await pull(client1, channel, () => true);
    expect(client1.syncTbl!.syncSize()).toBe(1);
    expect(client2.syncTbl!.syncSize()).toBe(1);
    expect(client1.syncTbl!.syncGetRecord('TEST1')!.amount).not.toEqual(
      client2.syncTbl!.syncGetRecord('TEST1')!.amount
    );
  });
});

describe('Dealing with multiple clients', () => {
  test('Clients updating separate records', async () => {
    const testRecord1 = tstRecord('TEST1');
    const testRecord2 = tstRecord('TEST2');
    const testRecord3 = tstRecord('TEST3');
    const server = await createVersionedTable<TstRecordType>({
      primaryKey: '_id',
      tableName: 'tst'
    });
    await server.addRecord(testRecord1);
    await server.addRecord(testRecord2);
    await server.addRecord(testRecord3);
    const channel = createInMemoryVTChannel(server);
    const {lastCommitId, rows} = await channel.cloneTable<TstRecordType>('tst');
    const client1 = await createVersionedTable<TstRecordType>({
      tableName: 'tst',
      primaryKey: '_id',
      initialData: {
        commitId: lastCommitId,
        data: rows
      }
    });
    const client2 = await createVersionedTable<TstRecordType>({
      tableName: 'tst',
      primaryKey: '_id',
      initialData: {
        commitId: lastCommitId,
        data: rows
      }
    });
    await client2.updateRecord('TEST2', {name: 'Not null anymore'});
    await push(client2, channel);
    const delta = server.getHistoryDelta(client1.lastRemoteCommitId!);
    expect(delta).not.toBe(null);
    expect(delta!.changes.length).toBe(1);
    expect(delta!.changes[0]).toMatchObject({
      changes: {name: 'Not null anymore'}
    });
  });
});
