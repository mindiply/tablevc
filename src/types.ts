export type Id = number | string;

export interface KeyFilter<RecordType> {
  (record: RecordType): boolean;
}

export interface SyncReadTable<RecordType> {
  syncGetRecord: (key: Id) => RecordType | undefined;
  syncGetRecords: (keys?: Id[] | KeyFilter<RecordType>) => RecordType[];
  syncHasRecord: (key: Id) => boolean;
  syncAllKeys: (filter?: KeyFilter<RecordType>) => Id[];
  syncSize: () => number;
}

export interface ReadTable<RecordType> {
  getRecord: (key: Id) => Promise<RecordType | undefined>;
  getRecords: (keys?: Id[] | KeyFilter<RecordType>) => Promise<RecordType[]>;
  hasRecord: (key: Id) => Promise<boolean>;
  allKeys: (filter?: KeyFilter<RecordType>) => Promise<Id[]>;
  size: () => Promise<number>;
}

export interface WritableTable<RecordType> extends ReadTable<RecordType> {
  setRecord: (key: Id, record: RecordType) => Promise<void>;
  deleteRecord: (key: Id) => Promise<void>;
}

export interface TableTransactionBody<RecordType, ReturnType = any> {
  (writableTable: WritableTable<RecordType>): Promise<ReturnType>;
}

export interface Table<RecordType> extends ReadTable<RecordType> {
  readonly syncTbl: null | SyncReadTable<RecordType>;
  tx: <ReturnType = any>(
    txBody: TableTransactionBody<RecordType, ReturnType>
  ) => Promise<ReturnType>;
}

export enum TableOperationType {
  ADD_RECORD = 'AddRecord',
  CHANGE_RECORD = 'ChangeRecord',
  DELETE_RECORD = 'DeleteRecord'
}

export enum HistoryOperationType {
  HISTORY_INIT = 'HistoryInit',
  HISTORY_FULL_TABLE_REFRESH = 'HistoryFullTableRefresh',
  HISTORY_MERGE_IN = 'HistoryMergeInOperation',
  TABLE_RECORD_CHANGE = 'TableRecordChange'
}

export interface BaseHistoryEntry {
  commitId: string;
  when: Date;
  who?: Id;
}

export interface AddRecord<RecordType> {
  __typename: TableOperationType.ADD_RECORD;
  id: Id;
  record: RecordType;
}

export interface ChangeRecord<RecordType> {
  __typename: TableOperationType.CHANGE_RECORD;
  id: Id;
  original: RecordType;
  changes: Partial<RecordType>;
}

export interface DeleteRecord<RecordType> {
  __typename: TableOperationType.DELETE_RECORD;
  id: Id;
  original: RecordType;
}

export type TableRecordChange<RecordType> =
  | AddRecord<RecordType>
  | ChangeRecord<RecordType>
  | DeleteRecord<RecordType>;

export interface RecordChangeOperation<RecordType> extends BaseHistoryEntry {
  __typename: HistoryOperationType.TABLE_RECORD_CHANGE;
  change: TableRecordChange<RecordType>;
}

export interface HistoryInit extends BaseHistoryEntry {
  __typename: HistoryOperationType.HISTORY_INIT;
}

export interface HistoryFullTableRefresh<RecordType> extends BaseHistoryEntry {
  __typename: HistoryOperationType.HISTORY_FULL_TABLE_REFRESH;
  nRows: number;
  sampleRows: RecordType[];
}

export const isTableRecordOperation = (
  obj: any
): obj is RecordChangeOperation<any> =>
  obj &&
  typeof obj === 'object' &&
  obj.__typename &&
  obj.__typename === HistoryOperationType.TABLE_RECORD_CHANGE;

export interface TableHistoryLocal<RecordType> {
  readonly tbl: ReadTable<RecordType>;
  readonly syncTbl: null | SyncReadTable<RecordType>;
  addRecord: (recordId: Id, record: RecordType) => Promise<RecordType>;
  updateRecord: (
    recordId: Id,
    recordChanges: Partial<RecordType>
  ) => Promise<RecordType>;
  deleteRecord: (recordId: Id) => Promise<boolean>;
  lastCommitId: () => string;
  firstCommitId: () => string;
  nextCommitIdOf: (commitId: string) => string | null;
  prevCommitIdOf: (commitId: string) => string | null;
}

export interface HistoryTransaction<RecordType, ReturnType = any> {
  (tblHistory: TableHistoryLocal<RecordType>): Promise<ReturnType>;
}

export interface TableHistoryDelta<RecordType> {
  afterCommitId: string;
  commitsIds: string[];
  changes: TableRecordChange<RecordType>[];
}

export const isTableHistoryDelta = (obj: any): obj is TableHistoryDelta<any> =>
  obj &&
  typeof obj === 'object' &&
  typeof obj.afterCommitId === 'string' &&
  Array.isArray(obj.commitsIds) &&
  Array.isArray(obj.changes);

export interface TableMergeDelta<RecordType> {
  afterCommitId: string;
  mergedInCommitsIds: string[];
  existingCommitsIds: string[];
  changes: TableRecordChange<RecordType>[];
}

export const isTableMergeDelta = (obj: any): obj is TableMergeDelta<any> =>
  obj &&
  typeof obj === 'object' &&
  typeof obj.afterCommitId === 'string' &&
  Array.isArray(obj.mergedInCommitsIds) &&
  Array.isArray(obj.existingCommitsIds) &&
  Array.isArray(obj.changes);

export interface HistoryMergeOperation<RecordType> extends BaseHistoryEntry {
  __typename: HistoryOperationType.HISTORY_MERGE_IN;
  mergeDelta: TableMergeDelta<RecordType>;
}

export type TableHistoryEntry<RecordType> =
  | RecordChangeOperation<RecordType>
  | HistoryInit
  | HistoryFullTableRefresh<RecordType>
  | HistoryMergeOperation<RecordType>;

export interface HistoryChannel<RecordType> {
  (delta: TableHistoryDelta<RecordType>): Promise<
    TableHistoryDelta<RecordType>
  >;
}

export interface TableHistory<RecordType>
  extends TableHistoryLocal<RecordType> {
  refreshTable: (
    populationData: HistoryPopulationData<RecordType>
  ) => Promise<void>;
  tx: <ReturnType = any>(
    txBody: HistoryTransaction<RecordType, ReturnType>
  ) => Promise<ReturnType>;
  getHistoryDelta: (
    fromCommitId: string,
    toCommitId?: string
  ) => null | TableHistoryDelta<RecordType>;
  mergeWith: (
    historyDelta: TableHistoryDelta<RecordType>
  ) => Promise<TableMergeDelta<RecordType> | null>;
  applyMerge: (mergeDelta: TableMergeDelta<RecordType>) => Promise<void>;
}

export interface GetRecordIdFn<RecordType> {
  (record: RecordType): Id;
}

export interface TablePopulationData<RecordType> {
  idExtract: GetRecordIdFn<RecordType>;
  data: RecordType[];
}

export interface HistoryPopulationData<RecordType>
  extends TablePopulationData<RecordType> {
  commitId: string;
}

export interface TableFactory<RecordType> {
  (options?: TablePopulationData<RecordType>): Table<RecordType>;
}

export interface HistoryFactoryOptions<RecordType> {
  who?: Id;
  populationData?: HistoryPopulationData<RecordType>;
}

export interface TableHistoryFactory<RecordType> {
  (
    tableFactory: TableFactory<RecordType>,
    historyOptions: HistoryFactoryOptions<RecordType>
  ): Promise<TableHistory<RecordType>>;
}
