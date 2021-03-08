export type Id = number | string;

export interface KeyFilter<RecordType> {
  (row: RecordType): boolean;
}

export interface AddRecordFn<RecordType> {
  (recordId: Id, row: RecordType): Promise<RecordType>;
  (row: Partial<RecordType>): Promise<RecordType>;
}

export interface SyncReadTable<RecordType> {
  readonly tableName: string;
  readonly primaryKey: keyof RecordType;
  syncGetRecord: (key: Id) => RecordType | undefined;
  syncGetRecords: (keys?: Id[] | KeyFilter<RecordType>) => RecordType[];
  syncHasRecord: (key: Id) => boolean;
  syncAllKeys: (filter?: KeyFilter<RecordType>) => Id[];
  syncSize: () => number;
}

export interface ReadTable<RecordType> {
  readonly tableName: string;
  readonly primaryKey: keyof RecordType;
  getRecord: (key: Id) => Promise<RecordType | undefined>;
  getRecords: (keys?: Id[] | KeyFilter<RecordType>) => Promise<RecordType[]>;
  hasRecord: (key: Id) => Promise<boolean>;
  allKeys: (filter?: KeyFilter<RecordType>) => Promise<Id[]>;
  size: () => Promise<number>;
}

export interface WritableTable<RecordType> extends ReadTable<RecordType> {
  setRecord: AddRecordFn<RecordType>;
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
  row: RecordType;
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

export interface VersionedTableChangeListener<RecordType> {
  (tablevc: VersionedTable<RecordType>): void;
}

export interface LocalVersionedTable<RecordType> {
  readonly tbl: ReadTable<RecordType>;
  readonly syncTbl: null | SyncReadTable<RecordType>;
  addRecord: AddRecordFn<RecordType>;
  updateRecord: (
    recordId: Id,
    recordChanges: Partial<RecordType>
  ) => Promise<RecordType>;
  deleteRecord: (recordId: Id) => Promise<boolean>;
  lastCommitId: () => string;
  firstCommitId: () => string;
  nextCommitIdOf: (commitId: string) => string | null;
  prevCommitIdOf: (commitId: string) => string | null;
  branchVersionHistory: (
    toCommitId?: string
  ) => TableVersionHistory<RecordType>;
}

export interface HistoryTransaction<RecordType, ReturnType = any> {
  (tblHistory: LocalVersionedTable<RecordType>): Promise<ReturnType>;
}

export interface TableHistoryDelta<RecordType> {
  afterCommitId: string;
  commitsIds: string[];
  changes: TableRecordChange<RecordType>[];
}

export interface TableMergeDelta<RecordType> {
  afterCommitId: string;
  mergedInCommitsIds: string[];
  existingCommitsIds: string[];
  changes: TableRecordChange<RecordType>[];
}

export interface HistoryMergeOperation<RecordType> extends BaseHistoryEntry {
  __typename: HistoryOperationType.HISTORY_MERGE_IN;
  mergeDelta: TableMergeDelta<RecordType>;
}

export type TableHistoryEntry<RecordType> =
  | RecordChangeOperation<RecordType>
  | HistoryInit
  | HistoryFullTableRefresh<RecordType>
  | HistoryMergeOperation<RecordType>;

export interface TableVersionMergeResult<RecordType> {
  localChanges: TableRecordChange<RecordType>[];
  mergeChanges: TableRecordChange<RecordType>[];
  localCommitsIds: string[];
  mergeCommitsIds: string[];
}

/**
 * The table version history represents a potentially
 * partial history of the changes to a table in a specific
 * branch.
 *
 * The history only deals with a history of operations performed
 * to a table, it does not directly affect the table with data
 * it refers to.
 *
 * Objects of this class can determine what changes will be needed
 * if we were to merge and rebase the history with external deltas.
 *
 */
export interface TableVersionHistory<RecordType> {
  entries: (
    afterCommitId: string,
    toCommitId?: string
  ) => Iterable<TableHistoryEntry<RecordType>>;

  readonly length: number;

  push: (entry: TableHistoryEntry<RecordType>) => Promise<number>;

  /**
   * For storage backed version histories allows to load the latest changes
   * that were saved tot he storage
   * @returns {Promise<number>}
   */
  refreshFromStorage: () => Promise<number>;

  clear: () => void;

  indexOf: (commitId: string) => number;

  getByIndex: (index: number) => TableHistoryEntry<RecordType>;

  nextCommitIdOf: (commitId: string) => string | null;

  previousCommitIdOf: (commitId: string) => string | null;

  lastCommitId: () => string | null;

  branch: (untilCommitId?: string) => TableVersionHistory<RecordType>;

  getHistoryDelta: (
    fromCommitId: string,
    toCommitId?: string
  ) => TableHistoryDelta<RecordType> | null;

  mergeInRemoteDelta: (
    historyDelta: TableMergeDelta<RecordType> | TableHistoryDelta<RecordType>
  ) => null | TableVersionMergeResult<RecordType>;

  rebaseWithMergeDelta: (
    mergeDelta: TableMergeDelta<RecordType>
  ) => TableRecordChange<RecordType>[];
}

export interface VersionedTableCloneResult<RecordType> {
  rows: RecordType[];
  lastCommitId: string;
}

export interface VersionedTablesChannel {
  pushChanges: <RecordType>(
    tableName: string,
    delta: TableHistoryDelta<RecordType>
  ) => Promise<HistoryMergeOperation<RecordType>>;

  pullChanges: <RecordType>(
    tableName: string,
    fromCommitId: string
  ) => Promise<HistoryMergeOperation<RecordType>>;

  cloneTable: <RecordType>(
    tableName: string
  ) => Promise<VersionedTableCloneResult<RecordType>>;
}

export interface PushToServerChannel<RecordType> {
  (
    delta: TableHistoryDelta<RecordType>
  ): Promise<HistoryMergeOperation<RecordType> | null>;
}

export interface PullFromServerChannel<RecordType> {
  (mergeDelta: HistoryMergeOperation<RecordType>): Promise<void>;
}

/**
 * Allows manipulating a table of data while keeping a history
 * of the record level changes that happen to bring it to its current
 * status.
 *
 * It also allows merging in deltas from external clients, and bringing
 * the table back to a desired state from a remote merge result.
 */
export interface VersionedTable<RecordType>
  extends LocalVersionedTable<RecordType> {
  bulkLoad: (
    populationData: VersionedTablePopulationData<RecordType>
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
  ) => Promise<HistoryMergeOperation<RecordType> | null>;
  applyMerge: (mergeDelta: HistoryMergeOperation<RecordType>) => Promise<void>;

  subscribeToChanges: (
    listener: VersionedTableChangeListener<RecordType>
  ) => void;
  unsubscribeFromChanges: (
    listener: VersionedTableChangeListener<RecordType>
  ) => void;
}

/**
 * Represents the last commitId we synchronized via a merge or on initial data
 * load from the server.
 */
export interface ClientVersionedTable<RecordType>
  extends VersionedTable<RecordType> {
  readonly lastRemoteCommitId: null | string;
}

export interface TablePopulationData<RecordType> {
  data: RecordType[];
}

export interface VersionedTablePopulationData<RecordType>
  extends TablePopulationData<RecordType> {
  commitId: string;
}

export interface TableFactory<RecordType> {
  (
    tableName: string,
    primaryKey: keyof RecordType,
    options?: TablePopulationData<RecordType>
  ): Table<RecordType>;
}

export interface TableHistoryFactory<RecordType> {
  (options?: TableHistoryFactoryOptions):
    | TableVersionHistory<RecordType>
    | Promise<TableVersionHistory<RecordType>>;
}

export interface TableHistoryFactoryOptions {
  who?: Id;
  fromCommitId?: string;
  // populationData?: HistoryPopulationData<RecordType>;
}

export const isId = (obj: any): obj is Id =>
  typeof obj === 'string' || typeof obj === 'number';

export const isTableHistoryDelta = (obj: any): obj is TableHistoryDelta<any> =>
  obj &&
  typeof obj === 'object' &&
  typeof obj.afterCommitId === 'string' &&
  Array.isArray(obj.commitsIds) &&
  Array.isArray(obj.changes);

export const isTableMergeDelta = (obj: any): obj is TableMergeDelta<any> =>
  obj &&
  typeof obj === 'object' &&
  typeof obj.afterCommitId === 'string' &&
  Array.isArray(obj.mergedInCommitsIds) &&
  Array.isArray(obj.existingCommitsIds) &&
  Array.isArray(obj.changes);

export const isTableRecordOperation = (
  obj: any
): obj is RecordChangeOperation<any> =>
  obj &&
  typeof obj === 'object' &&
  obj.__typename &&
  obj.__typename === HistoryOperationType.TABLE_RECORD_CHANGE;

export enum DbType {
  memoryMap
}

export enum TableHistoryType {
  memoryHistory
}

export interface BaseCreateVersionedTableProps<RecordType> {
  tableName: string;
  primaryKey: keyof RecordType;
  dbType?: DbType | TableFactory<RecordType> | Table<RecordType>;
  versionHistoryType?:
    | TableHistoryType
    | TableHistoryFactory<RecordType>
    | TableVersionHistory<RecordType>;
  who?: Id;
}

export interface CreateVersionedTablePropsWithData<RecordType>
  extends BaseCreateVersionedTableProps<RecordType> {
  initialData?: VersionedTablePopulationData<RecordType>;
}

export interface CreateVersionedTablePropsFromCommit<RecordType>
  extends BaseCreateVersionedTableProps<RecordType> {
  fromCommitId?: string;
}

export type CreateVersionedTableProps<RecordType> =
  | CreateVersionedTablePropsFromCommit<RecordType>
  | CreateVersionedTablePropsWithData<RecordType>;

export interface EmptyMemoryVersionedTableProps<RecordType> {
  tableName: string;
  primaryKey: keyof RecordType;
  who?: Id;
}
