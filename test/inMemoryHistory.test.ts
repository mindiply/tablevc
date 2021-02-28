import {createHistory, HistoryOperationType, Id, TableOperationType} from '../src';

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

describe('Basic table interaction via history', () => {
  test('Table with empty history should have no records', async () => {
    const history = await createHistory();
    const nRecords = await history.tbl.size();
    expect(nRecords).toBe(0);
  });

  test('Table with one record', async () => {
    const history = await createHistory();
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
    const history = await createHistory<TstRecordType>();
    const testRecord = {
      ...emptyTestRecord(),
      _id: 'TEST1'
    };
    await history.addRecord('TEST1', testRecord);

    const testRecord2 = {
      ...emptyTestRecord(),
      _id: 'TEST2'
    };
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
    const history = await createHistory({
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
    const history = await createHistory({
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
    const history = await createHistory({
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
    const history = await createHistory<TstRecordType>();
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
    const history = await createHistory<TstRecordType>();
    const testRecord = {
      ...emptyTestRecord(),
      _id: 'TEST1'
    };
    await history.addRecord('TEST1', testRecord);
    await history.updateRecord('TEST1', {name: 'NewName'});
    await history.deleteRecord('TEST1')
    const delta = history.getHistoryDelta(history.firstCommitId());
    expect(delta).toBe(null);
  });
});