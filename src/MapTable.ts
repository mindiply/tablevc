/*
 * Table interface implemented through a Map
 * */

import {
  Id,
  isId,
  KeyFilter,
  SyncReadTable,
  Table,
  TablePopulationData,
  TableTransactionBody,
  WritableTable
} from './types';
import {generateNewId} from './generateId';

interface FullTableFunctionality<RecordType>
  extends Table<RecordType>,
    WritableTable<RecordType> {}

class MapTable<RecordType>
  implements FullTableFunctionality<RecordType>, SyncReadTable<RecordType> {
  private records: Map<Id, RecordType>;
  private readonly _primaryKey: keyof RecordType;
  private readonly _tableName: string;

  constructor(
    tableName: string,
    primaryKey: keyof RecordType,
    populationData?: TablePopulationData<RecordType>
  ) {
    this._tableName = tableName;
    this._primaryKey = primaryKey;
    if (populationData) {
      const {data} = populationData;
      this.records = new Map(
        data.map(row => [(row[primaryKey] as unknown) as Id, row])
      );
    } else {
      this.records = new Map();
    }
  }

  public get tableName() {
    return this._tableName;
  }

  public get syncTbl() {
    return this;
  }

  public get primaryKey() {
    return this._primaryKey;
  }

  public syncSize = () => this.records.size;

  public syncGetRecord = (key: Id) => {
    return this.records.get(key);
  };

  public syncHasRecord = (key: Id) => this.records.has(key);

  public syncAllKeys = (filter?: (record: RecordType) => boolean) =>
    filter
      ? Array.from(this.records.entries())
          .filter(([, record]) => filter(record))
          .map(([key]) => key)
      : Array.from(this.records.keys());

  public syncGetRecords = (keys?: Id[] | KeyFilter<RecordType>) => {
    if (keys === undefined) {
      return Array.from(this.records.values());
    }
    const records: RecordType[] = [];
    if (keys && Array.isArray(keys)) {
      for (const key of keys) {
        const record = this.records.get(key);
        if (record) {
          records.push(record);
        }
      }
    } else if (typeof keys === 'function') {
      for (const record of this.records.values()) {
        if (keys(record)) {
          records.push(record);
        }
      }
    }
    return records;
  };

  public size = async () => this.syncSize();

  public getRecord = async (key: Id) => this.syncGetRecord(key);

  public hasRecord = async (key: Id) => this.syncHasRecord(key);

  public allKeys = async (filter?: (record: RecordType) => boolean) =>
    this.syncAllKeys(filter);

  public setRecord = async (
    key: Id | Partial<RecordType>,
    record?: RecordType
  ) => {
    if (isId(key) && !record) {
      throw new Error('We need an object to insert');
    }
    const recordId = isId(key)
      ? key
      : key && this._primaryKey in key
      ? ((key[this._primaryKey] as unknown) as Id)
      : generateNewId();
    const element = isId(key)
      ? record!
      : this._primaryKey
      ? key
      : {...key, [this._primaryKey]: recordId};
    this.records.set(recordId, element as RecordType);
    return this.records.get(recordId)!;
  };

  public deleteRecord = async (key: Id) => {
    this.records.delete(key);
  };

  public tx = async <ReturnType = any>(
    txBody: TableTransactionBody<RecordType, ReturnType>
  ) => {
    const backup = new Map(this.records);
    try {
      const res = await txBody(this);
      return res;
    } catch (err) {
      this.records = backup;
      throw err;
    }
  };

  public getRecords = async (keys?: Id[] | KeyFilter<RecordType>) =>
    this.syncGetRecords(keys);
}

export const mapTableFactory = <RecordType>(
  tableName: string,
  primaryKey: keyof RecordType,
  options?: TablePopulationData<RecordType>
): Table<RecordType> => new MapTable(tableName, primaryKey, options);
