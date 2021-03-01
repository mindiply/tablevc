import {createVersionedTable, Id, TableOperationType} from '../src';

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

function idExtract(record: TstRecordType): Id {
  return record._id;
}

describe('Basic table interaction via history', () => {
  test('Table with empty history should have no records', async () => {
    const history = await createVersionedTable();
    const nRecords = await history.tbl.size();
    expect(nRecords).toBe(0);
  });

  test('Table with one record', async () => {
    const history = await createVersionedTable();
    const testRecord = {
      ...emptyTestRecord(),
      _id: 'TEST1'
    };
    await history.addRecord('TEST1', testRecord);
    const nRecords = await history.tbl.size();
    const record = await history.tbl.getRecord('TEST1');
    expect(nRecords).toBe(1);
    expect(record).toEqual(testRecord);
  });

  test('Table with two records, one being changed', async () => {
    const history = await createVersionedTable<TstRecordType>();
    const testRecord = {
      ...emptyTestRecord(),
      _id: 'TEST1'
    };
    await history.addRecord('TEST1', testRecord);

    await history.addRecord('TEST2', testRecord);
    await history.updateRecord('TEST1', {name: 'Test 1 is my name'});
    const nRecords = await history.tbl.size();
    const record = await history.tbl.getRecord('TEST1');
    expect(nRecords).toBe(2);
    expect(record.name).toEqual('Test 1 is my name');
  });

  test('Initialise with one record', async () => {
    const testRecord = {
      ...emptyTestRecord(),
      _id: 'TEST1'
    };
    const history = await createVersionedTable({
      initialData: {
        commitId: 'TEST_COMMIT_ID',
        idExtract: (record: TstRecordType) => record._id,
        data: [testRecord]
      }
    });
    const nRecords = await history.tbl.size();
    const record = await history.tbl.getRecord('TEST1');
    expect(nRecords).toBe(1);
    expect(record).toEqual(testRecord);

    const tbl = history.syncTbl!;

    expect(tbl.syncSize()).toBe(1);
    expect(tbl.syncGetRecord('TEST1')).toEqual(testRecord);
  });

  test('Initialise with multiple records, delete one', async () => {
    const testRecord = {
      ...emptyTestRecord(),
      _id: 'TEST1'
    };
    const testRecord2 = {
      ...emptyTestRecord(),
      _id: 'TEST2'
    };
    const testRecord3 = {
      ...emptyTestRecord(),
      _id: 'TEST3'
    };
    const history = await createVersionedTable({
      initialData: {
        commitId: 'TEST_COMMIT_ID',
        idExtract: (record: TstRecordType) => record._id,
        data: [testRecord, testRecord2, testRecord3]
      }
    });
    const nRecords = await history.tbl.size();
    const record = await history.tbl.getRecord('TEST1');
    expect(nRecords).toBe(3);
    expect(record).toEqual(testRecord);

    await history.deleteRecord('TEST1');
    const tbl = history.syncTbl!;

    expect(tbl.syncSize()).toBe(2);
    expect(tbl.syncGetRecord('TEST1')).toEqual(undefined);
    expect(tbl.syncGetRecord('TEST2')).toEqual(testRecord2);
  });

  test('Perform a transaction', async () => {
    const testRecord = {
      ...emptyTestRecord(),
      _id: 'TEST1'
    };
    const history = await createVersionedTable({
      initialData: {
        commitId: 'TEST_COMMIT_ID',
        idExtract: (record: TstRecordType) => record._id,
        data: [testRecord]
      }
    });
    await history.tx(async db => {
      const testRecord2 = {
        ...emptyTestRecord(),
        _id: 'TEST2'
      };
      const testRecord3 = {
        ...emptyTestRecord(),
        _id: 'TEST3'
      };
      await db.addRecord('TEST2', testRecord2);
      await db.updateRecord('TEST1', {name: 'Test 1 is my name'});
      await db.addRecord('TEST3', testRecord3);
      await db.deleteRecord('TEST2');
    });
    const tbl = history.syncTbl!;
    expect(tbl.syncGetRecord('TEST2')).toBe(undefined);
    expect(tbl.syncSize()).toBe(2);
    expect(tbl.syncGetRecord('TEST1').name).toBe('Test 1 is my name');
  });
});

describe('Generating deltas', () => {
  test('Generate a straight forward delta', async () => {
    const history = await createVersionedTable<TstRecordType>();
    const testRecord = {
      ...emptyTestRecord(),
      _id: 'TEST1'
    };
    await history.addRecord('TEST1', testRecord);
    const delta = history.getHistoryDelta(history.firstCommitId())!;
    expect(delta.changes.length).toBe(1);
    expect(delta.changes[0].__typename).toBe(TableOperationType.ADD_RECORD);
  });

  test('Generate an empty delta', async () => {
    const history = await createVersionedTable<TstRecordType>();
    const testRecord = {
      ...emptyTestRecord(),
      _id: 'TEST1'
    };
    await history.addRecord('TEST1', testRecord);
    await history.updateRecord('TEST1', {name: 'NewName'});
    await history.deleteRecord('TEST1');
    const delta = history.getHistoryDelta(history.firstCommitId());
    expect(delta).toBe(null);
  });
});

describe('Merging different branches', () => {
  test('Perform not conflicting synchronization', async () => {
    const testRecord = {
      ...emptyTestRecord(),
      _id: 'TEST1'
    };
    const testRecord2 = {
      ...emptyTestRecord(),
      _id: 'TEST2'
    };
    const h1 = await createVersionedTable<TstRecordType>();
    const h2 = await createVersionedTable<TstRecordType>({
      initialData: {
        commitId: h1.lastCommitId(),
        data: [],
        idExtract
      }
    });
    await h1.addRecord(testRecord._id, testRecord);
    await h2.addRecord(testRecord2._id, testRecord2);
    const h2Delta = h2.getHistoryDelta(h1.firstCommitId());
    const mergeDelta = await h1.mergeWith(h2Delta!);
    await h2.applyMerge(mergeDelta!);

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
    const h1 = await createVersionedTable<TstRecordType>();
    await h1.addRecord(testRecord._id, testRecord);
    const branchingCommitId = h1.lastCommitId();
    const h2 = await createVersionedTable<TstRecordType>({
      initialData: {
        commitId: branchingCommitId,
        data: h1.syncTbl!.syncGetRecords(),
        idExtract
      }
    });
    await h2.addRecord(testRecord2._id, testRecord2);
    await h2.deleteRecord(testRecord._id);
    await h1.updateRecord(testRecord._id, {amount: 251177});
    const h2Delta = h2.getHistoryDelta(branchingCommitId);
    const mergeDelta = await h1.mergeWith(h2Delta!);
    await h2.applyMerge(mergeDelta!);

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

  test('Perform non conflicting concurrent synchronization', async () => {
    const testRecord = {
      ...emptyTestRecord(),
      _id: 'TEST1'
    };
    const testRecord2 = {
      ...emptyTestRecord(),
      _id: 'TEST2'
    };
    const h1 = await createVersionedTable<TstRecordType>();
    await h1.addRecord(testRecord._id, testRecord);
    const branchingCommitId = h1.lastCommitId();
    const h2 = await createVersionedTable<TstRecordType>({
      initialData: {
        commitId: branchingCommitId,
        data: h1.syncTbl!.syncGetRecords(),
        idExtract
      }
    });
    await h2.addRecord(testRecord2._id, testRecord2);
    await h2.updateRecord(testRecord._id, {name: 'Updated Test Record 1'});
    await h1.updateRecord(testRecord._id, {amount: 251177});
    const h2Delta = h2.getHistoryDelta(branchingCommitId);
    const mergeDelta = await h1.mergeWith(h2Delta!);
    await h2.applyMerge(mergeDelta!);

    expect(h1.syncTbl!.syncSize()).toBe(2);
    expect(h1.syncTbl!.syncGetRecord('TEST1')).toEqual({
      ...testRecord,
      name: 'Updated Test Record 1',
      amount: 251177
    });
    expect(h1.syncTbl!.syncGetRecord('TEST2')).toEqual(testRecord2);
    expect(h2.syncTbl!.syncSize()).toBe(2);
    expect(h2.syncTbl!.syncGetRecord('TEST1')).toEqual({
      ...testRecord,
      name: 'Updated Test Record 1',
      amount: 251177
    });
    expect(h2.syncTbl!.syncGetRecord('TEST2')).toEqual(testRecord2);
  });

  test('Perform conflicting concurrent synchronization - change vs delete - laborious delete', async () => {
    const testRecord = {
      ...emptyTestRecord(),
      _id: 'TEST1'
    };
    const testRecord2 = {
      ...emptyTestRecord(),
      _id: 'TEST2'
    };
    const h1 = await createVersionedTable<TstRecordType>();
    await h1.addRecord(testRecord._id, testRecord);
    const branchingCommitId = h1.lastCommitId();
    const h2 = await createVersionedTable<TstRecordType>({
      initialData: {
        commitId: branchingCommitId,
        data: h1.syncTbl!.syncGetRecords(),
        idExtract
      }
    });
    await h2.addRecord(testRecord2._id, testRecord2);
    await h2.updateRecord(testRecord._id, {isTrue: false});
    await h2.deleteRecord(testRecord._id);
    await h1.updateRecord(testRecord._id, {amount: 251177});
    const h2Delta = h2.getHistoryDelta(branchingCommitId);
    const mergeDelta = await h1.mergeWith(h2Delta!);
    await h2.applyMerge(mergeDelta!);

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

  test('Synchronize after further changes since delta', async () => {
    const testRecord = {
      ...emptyTestRecord(),
      _id: 'TEST1'
    };
    const testRecord2 = {
      ...emptyTestRecord(),
      _id: 'TEST2'
    };
    const h1 = await createVersionedTable<TstRecordType>();
    await h1.addRecord(testRecord._id, testRecord);
    const branchingCommitId = h1.lastCommitId();
    const h2 = await createVersionedTable<TstRecordType>({
      initialData: {
        commitId: branchingCommitId,
        data: h1.syncTbl!.syncGetRecords(),
        idExtract
      }
    });
    await h2.addRecord(testRecord2._id, testRecord2);
    await h2.updateRecord(testRecord._id, {isTrue: false});
    await h1.updateRecord(testRecord._id, {amount: 251177});
    const h2Delta = h2.getHistoryDelta(branchingCommitId);
    await h2.updateRecord(testRecord._id, {
      amount: 140579,
      when: new Date(2021, 7, 3)
    });
    const mergeDelta = await h1.mergeWith(h2Delta!);
    expect(h2.syncTbl!.syncGetRecord('TEST1')).toEqual({
      ...testRecord,
      amount: 140579,
      isTrue: false,
      when: new Date(2021, 7, 3)
    });
    await h2.applyMerge(mergeDelta!);
    expect(h2.syncTbl!.syncGetRecord('TEST1')).toEqual({
      ...testRecord,
      amount: 251177,
      isTrue: false,
      when: new Date(2021, 7, 3)
    });

    expect(h1.syncTbl!.syncSize()).toBe(2);
    expect(h1.syncTbl!.syncGetRecord('TEST1')).toEqual({
      ...testRecord,
      amount: 251177,
      isTrue: false
    });
    expect(h1.syncTbl!.syncGetRecord('TEST2')).toEqual(testRecord2);
    expect(h2.syncTbl!.syncSize()).toBe(2);
    expect(h2.syncTbl!.syncGetRecord('TEST2')).toEqual(testRecord2);
  });
});
