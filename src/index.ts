import {
  VersionedTablePopulationData,
  Id,
  TableFactory,
  TableHistoryFactory,
  VersionedTable,
  TableVersionHistory,
  Table
} from './types';
import {mapTableFactory} from './MapTable';
import {
  createMappedVersioningHistoryList,
  internalCreateVersionedTable
} from './VersionedTable';
export {
  commitIdForOperation,
  MemoryTableVersionHistory
} from './VersionedTable';

export * from './types';

export enum DbType {
  memoryMap
}

export enum TableHistoryType {
  memoryHistory
}

interface BaseCreateVersionedTableProps<RecordType> {
  dbType?: DbType | TableFactory<RecordType> | Table<RecordType>;
  versionHistoryType?:
    | TableHistoryType
    | TableHistoryFactory<RecordType>
    | TableVersionHistory<RecordType>;
  who?: Id;
}

interface CreateVersionedTablePropsWithData<RecordType>
  extends BaseCreateVersionedTableProps<RecordType> {
  initialData?: VersionedTablePopulationData<RecordType>;
}

interface CreateVersionedTablePropsFromCommit<RecordType>
  extends BaseCreateVersionedTableProps<RecordType> {
  fromCommitId?: string;
}

export type CreateVersionedTableProps<RecordType> =
  | CreateVersionedTablePropsFromCommit<RecordType>
  | CreateVersionedTablePropsWithData<RecordType>;

const dbTypeFactory = (dbType: DbType): TableFactory<any> => {
  if (dbType === DbType.memoryMap) {
    return mapTableFactory;
  }
  throw new TypeError('Factory type unrecognized');
};

const tableHistoryFactoryForType = (
  historyType: TableHistoryType
): TableHistoryFactory<any> => {
  if (historyType === TableHistoryType.memoryHistory) {
    return createMappedVersioningHistoryList;
  }
  throw new Error('History type not recognized');
};

export async function createVersionedTable<RecordType>(
  options: CreateVersionedTableProps<RecordType> = {
    versionHistoryType: TableHistoryType.memoryHistory,
    dbType: DbType.memoryMap
  }
): Promise<VersionedTable<RecordType>> {
  const {
    versionHistoryType = TableHistoryType.memoryHistory,
    dbType = DbType.memoryMap,
    who
  } = options;
  const dbFactory = typeof dbType === 'number' ? dbTypeFactory(dbType) : dbType;
  const tableHistoryFactory =
    typeof versionHistoryType === 'number'
      ? (tableHistoryFactoryForType(
          versionHistoryType
        ) as TableHistoryFactory<RecordType>)
      : versionHistoryType;
  const fromCommitId = (options as CreateVersionedTablePropsFromCommit<RecordType>)
    .fromCommitId;
  const tableHistory =
    typeof tableHistoryFactory === 'function'
      ? await tableHistoryFactory({
          who,
          fromCommitId
        })
      : tableHistoryFactory;
  const versionedTable = internalCreateVersionedTable({
    tableHistory,
    table: typeof dbFactory === 'function' ? dbFactory() : dbFactory,
    who
  });
  if (
    options &&
    (options as CreateVersionedTablePropsWithData<RecordType>).initialData
  ) {
    await versionedTable.bulkLoad(
      (options as CreateVersionedTablePropsWithData<RecordType>).initialData!
    );
  }
  return versionedTable;
}
