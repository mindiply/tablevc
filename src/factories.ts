import {
  CreateVersionedTableProps,
  CreateVersionedTablePropsFromCommit,
  CreateVersionedTablePropsWithData,
  DbType,
  TableFactory,
  TableHistoryFactory,
  TableHistoryType,
  VersionedTable
} from './types';
import {
  createMappedVersioningHistoryList,
  internalCreateVersionedTable
} from './VersionedTable';
import {mapTableFactory} from './MapTable';

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
  options: CreateVersionedTableProps<RecordType>
): Promise<VersionedTable<RecordType>> {
  const {
    dbType = DbType.memoryMap,
    versionHistoryType = TableHistoryType.memoryHistory,
    primaryKey,
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
    table: typeof dbFactory === 'function' ? dbFactory(primaryKey) : dbFactory,
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
