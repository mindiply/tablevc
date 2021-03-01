import {
  HistoryPopulationData,
  Id,
  TableFactory,
  VersionedTableFactory
} from './types';
import {mapTableFactory} from './MapTable';
import {InMemoryHistoryFactory} from './InMemoryHistory';

export * from './types';

export enum DbType {
  memoryMap
}

export enum HistoryType {
  memoryHistory
}

interface CreateHistoryProps<RecordType> {
  dbType?: DbType | TableFactory<RecordType>;
  historyType?: HistoryType;
  initialData?: HistoryPopulationData<RecordType>;
  who?: Id;
}

const dbTypeFactory = (dbType: DbType): TableFactory<any> => {
  if (dbType === DbType.memoryMap) {
    return mapTableFactory;
  }
  throw new TypeError('Factory type unrecognized');
};

const historyTypeFactory = (
  historyType: HistoryType
): VersionedTableFactory<any> => {
  if (historyType === HistoryType.memoryHistory) {
    return InMemoryHistoryFactory;
  }
  throw new Error('History type not recognized');
};

export async function createVersionedTable<RecordType>(
  options: CreateHistoryProps<RecordType> = {
    historyType: HistoryType.memoryHistory,
    dbType: DbType.memoryMap
  }
) {
  const {
    historyType = HistoryType.memoryHistory,
    dbType = DbType.memoryMap,
    initialData,
    who
  } = options;
  const dbFactory = typeof dbType === 'number' ? dbTypeFactory(dbType) : dbType;
  const historyFactory = historyTypeFactory(historyType);
  const history = await historyFactory(dbFactory, {
    populationData: initialData,
    who
  });
  return history;
}
