import {
  and,
  equals,
  fieldReference,
  Id,
  mapTableFactory,
  notEquals,
  or,
  scalarValue
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

const sampleData = (): TstRecordType[] => [
  {
    ...emptyTestRecord()
  },
  {
    ...emptyTestRecord(),
    amount: 100,
    name: 'second',
    isTrue: false
  },
  {
    ...emptyTestRecord(),
    when: new Date(2021, 10, 25)
  },
  {
    ...emptyTestRecord(),
    isTrue: false,
    amount: 3.14
  }
];

describe('Ability to filter data - sync', () => {
  test('Equality', async () => {
    const filter = equals(
      fieldReference<TstRecordType>('name'),
      scalarValue('second')
    );
    const tbl = mapTableFactory<TstRecordType>('Tst', '_id', {
      data: sampleData()
    });
    const syncRecords = tbl.syncTbl!.syncGetRecords(filter);
    expect(syncRecords.length).toBe(1);
    expect(syncRecords[0]).toMatchObject({
      amount: 100,
      name: 'second',
      isTrue: false
    });
    const asyncRecords = await tbl.getRecords(filter);
    expect(asyncRecords.length).toBe(1);
    expect(asyncRecords[0]).toMatchObject({
      amount: 100,
      name: 'second',
      isTrue: false
    });
  });

  test('InEquality', async () => {
    const filter = notEquals(
      fieldReference<TstRecordType>('name'),
      scalarValue('second')
    );
    const tbl = mapTableFactory<TstRecordType>('Tst', '_id', {
      data: sampleData()
    });
    const syncRecords = tbl.syncTbl!.syncGetRecords(filter);
    expect(syncRecords.length).toBe(3);
    expect(syncRecords[2]).toMatchObject({
      isTrue: false,
      amount: 3.14
    });
    const asyncRecords = await tbl.getRecords(filter);
    expect(asyncRecords.length).toBe(3);
    expect(asyncRecords[2]).toMatchObject({
      isTrue: false,
      amount: 3.14
    });
  });

  test('And and or', async () => {
    const filter = or(
      and(
        notEquals(fieldReference<TstRecordType>('name'), scalarValue('second')),
        equals(fieldReference<TstRecordType>('amount'), scalarValue(100))
      ),
      equals(fieldReference<TstRecordType>('amount'), scalarValue(3.14))
    );
    const tbl = mapTableFactory<TstRecordType>('Tst', '_id', {
      data: sampleData()
    });
    const syncRecords = tbl.syncTbl!.syncGetRecords(filter);
    expect(syncRecords.length).toBe(1);
    expect(syncRecords[0]).toMatchObject({
      isTrue: false,
      amount: 3.14
    });
    const asyncRecords = await tbl.getRecords(filter);
    expect(asyncRecords.length).toBe(1);
    expect(asyncRecords[0]).toMatchObject({
      isTrue: false,
      amount: 3.14
    });
  });
});
