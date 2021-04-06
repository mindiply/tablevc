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
import {
  BaseFilterExpression,
  EmptyFilterExpression,
  FilterExpressionType,
  TableFilterExpression
} from './tableFiltersTypes';
import {isBinaryFilter, isTableFilterExpression} from './tableFilterExpression';

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

  public syncAllKeys = <
    Ext extends BaseFilterExpression = EmptyFilterExpression
  >(
    filter?: KeyFilter<RecordType> | TableFilterExpression<RecordType, Ext>
  ) => {
    return this.syncGetRecords(filter).map(
      record => (record[this.primaryKey] as unknown) as Id
    );
  };

  public syncGetRecords = <
    Ext extends BaseFilterExpression = EmptyFilterExpression
  >(
    keys?: Id[] | KeyFilter<RecordType> | TableFilterExpression<RecordType, Ext>
  ) => {
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
    } else if (isTableFilterExpression(keys)) {
      const filterFn = filterFunctionFromExpression<RecordType>(keys);
      for (const record of this.records.values()) {
        if (filterFn(record)) {
          records.push(record);
        }
      }
    } else if (typeof keys === 'function') {
      for (const record of this.records.values()) {
        if ((keys as KeyFilter<RecordType>)(record)) {
          records.push(record);
        }
      }
    }
    return records;
  };

  public size = async () => this.syncSize();

  public getRecord = async (key: Id) => this.syncGetRecord(key);

  public hasRecord = async (key: Id) => this.syncHasRecord(key);

  public allKeys = async <
    Ext extends BaseFilterExpression = EmptyFilterExpression
  >(
    filter?: KeyFilter<RecordType> | TableFilterExpression<RecordType, Ext>
  ) => this.syncAllKeys(filter);

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

  public getRecords = async <
    Ext extends BaseFilterExpression = EmptyFilterExpression
  >(
    keys?: Id[] | KeyFilter<RecordType> | TableFilterExpression<RecordType, Ext>
  ) => this.syncGetRecords(keys);
}

export const mapTableFactory = <RecordType>(
  tableName: string,
  primaryKey: keyof RecordType,
  options?: TablePopulationData<RecordType>
): Table<RecordType> => new MapTable(tableName, primaryKey, options);

function filterFunctionFromExpression<RecordType>(
  filterExpression: TableFilterExpression<RecordType>
): KeyFilter<RecordType> {
  const resolveFn = resolveFilterExpression(filterExpression);
  return (record: RecordType) => Boolean(resolveFn(record));
}

function resolveFilterExpression<RecordType = any>(
  filterExpression: TableFilterExpression<RecordType>
): (record: RecordType) => any {
  if (isBinaryFilter(filterExpression)) {
    const leftFn = resolveFilterExpression(filterExpression.left);
    const rightFn = resolveFilterExpression(filterExpression.right);
    if (filterExpression.__typename === FilterExpressionType.equals) {
      return record => Boolean(leftFn(record) === rightFn(record));
    } else if (filterExpression.__typename === FilterExpressionType.notEquals) {
      return record => Boolean(leftFn(record) !== rightFn(record));
    } else if (filterExpression.__typename === FilterExpressionType.moreThan) {
      return record => Boolean(leftFn(record) > rightFn(record));
    } else if (
      filterExpression.__typename === FilterExpressionType.moreEquals
    ) {
      return record => Boolean(leftFn(record) >= rightFn(record));
    } else if (filterExpression.__typename === FilterExpressionType.lessThan) {
      return record => Boolean(leftFn(record) < rightFn(record));
    } else if (
      filterExpression.__typename === FilterExpressionType.lessEquals
    ) {
      return record => Boolean(leftFn(record) <= rightFn(record));
    }
  } else if (
    filterExpression.__typename === FilterExpressionType.fieldReference
  ) {
    return record => record[filterExpression.fieldReference];
  } else if (filterExpression.__typename === FilterExpressionType.scalar) {
    return () => filterExpression.value;
  } else if (
    filterExpression.__typename === FilterExpressionType.quotedString
  ) {
    return () => `'${filterExpression.text}'`;
  } else if (filterExpression.__typename === FilterExpressionType.not) {
    const toFilterFn = resolveFilterExpression(filterExpression.expression);
    return record => !Boolean(toFilterFn(record));
  } else if (
    filterExpression.__typename === FilterExpressionType.and ||
    filterExpression.__typename === FilterExpressionType.or
  ) {
    const filterFns = filterExpression.expressions.map(expression =>
      resolveFilterExpression(expression)
    );
    const breakIf =
      filterExpression.__typename === FilterExpressionType.or ? true : false;
    return record => {
      for (let i = 0; i < filterFns.length; i++) {
        if (filterFns[i](record) === breakIf) {
          return breakIf ? true : false;
        }
      }
      return !breakIf;
    };
  }
  return () => false;
}
