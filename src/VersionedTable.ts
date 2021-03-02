import jsSHA from 'jssha';
import {
  AddRecord,
  ChangeRecord,
  HistoryInit,
  HistoryMergeOperation,
  HistoryOperationType,
  VersionedTablePopulationData,
  HistoryTransaction,
  Id,
  isTableHistoryDelta,
  isTableMergeDelta,
  RecordChangeOperation,
  Table,
  TableHistoryDelta,
  TableHistoryEntry,
  TableMergeDelta,
  TableOperationType,
  TableRecordChange,
  TableTransactionBody,
  TableVersionHistory,
  WritableTable,
  ClientVersionedTable,
  TableHistoryFactoryOptions
} from './types';

interface HistoryCreationProps<RecordType> {
  tableHistory: TableVersionHistory<RecordType>;
  table: Table<RecordType>;
  who?: Id;
}

export function commitIdForOperation(
  operation: Omit<TableHistoryEntry<any>, 'commitId'>
): string {
  const shaObj = new jsSHA('SHA-512', 'TEXT');
  shaObj.update(JSON.stringify({...operation, __rnd: Math.random()}));
  return shaObj.getHash('HEX');
}

class HistoryEntriesIterator<RecordType>
  implements
    Iterator<TableHistoryEntry<RecordType>>,
    Iterable<TableHistoryEntry<RecordType>> {
  private nextIndex: number;
  private readonly records: TableHistoryEntry<RecordType>[];
  private readonly lastIndex: number;

  constructor(
    records: TableHistoryEntry<RecordType>[],
    firstIndex: number,
    lastIndex: number
  ) {
    this.records = records;
    this.lastIndex = lastIndex;
    this.nextIndex = firstIndex;
  }

  public next = () => {
    const nextResult: IteratorResult<TableHistoryEntry<RecordType>, undefined> =
      this.nextIndex > this.lastIndex
        ? {
            done: true,
            value: undefined
          }
        : {
            value: this.records[this.nextIndex],
            done: false
          };
    this.nextIndex++;
    return nextResult;
  };

  public [Symbol.iterator]() {
    return this;
  }
}

/**
 * Memory only implementation of TableVersionHistory.
 *
 * Can be useful to extend from or as implementation object of
 * other types of histories
 */
export class MemoryTableVersionHistory<RecordType>
  implements TableVersionHistory<RecordType> {
  private recordsList: TableHistoryEntry<RecordType>[];
  private recordsById: Map<string, number>;

  constructor(initialElements: TableHistoryEntry<RecordType>[] = []) {
    this.recordsList = initialElements;
    this.recordsById = new Map(
      initialElements.map((record, index) => [record.commitId, index])
    );
  }

  public branch = (untilCommitId?: string) => {
    if (!untilCommitId) {
      return new MemoryTableVersionHistory([...this.recordsList]);
    }
    const targetIndex = this.indexOf(untilCommitId);
    return new MemoryTableVersionHistory(
      targetIndex !== -1
        ? this.recordsList.slice(0, targetIndex + 1)
        : this.recordsList.slice()
    );
  };

  public get length() {
    return this.recordsList.length;
  }

  public refreshFromStorage = async () => this.recordsList.length;

  /**
   * Returns an iterator with all the history entries in the range
   * ]afterCommitId,toCommitId] - e.g. the entry of the start commit id
   * is excluded.
   * @param afterCommitId
   * @param toCommitId
   */
  public entries = (
    afterCommitId: string,
    toCommitId?: string
  ): Iterable<TableHistoryEntry<RecordType>> => {
    const startIndex = this.indexOf(afterCommitId);
    const targetCommitId = toCommitId || this.lastCommitId();
    const lastIndex = targetCommitId ? this.indexOf(targetCommitId) : -1;
    if (startIndex === -1 || lastIndex === -1) {
      // Iterator that is immediately done
      return new HistoryEntriesIterator(this.recordsList, 1, 0);
    }
    return new HistoryEntriesIterator(
      this.recordsList,
      startIndex + 1,
      lastIndex
    );
  };

  public push = async (
    entry: TableHistoryEntry<RecordType>
  ): Promise<number> => {
    const index = this.recordsList.push(entry) - 1;
    this.recordsById.set(entry.commitId, index);
    return this.recordsList.length;
  };

  public clear = () => {
    this.recordsList = [];
    this.recordsById = new Map();
  };

  public indexOf = (commitId: string): number => {
    const index = this.recordsById.get(commitId);
    return index !== undefined ? index : -1;
  };

  public getByIndex = (index: number): TableHistoryEntry<RecordType> => {
    if (index >= 0 && index < this.recordsList.length) {
      return this.recordsList[index];
    }
    throw new RangeError('Index does not exist');
  };

  public nextCommitIdOf = (commitId: string): string | null => {
    const startIndex = this.indexOf(commitId);
    if (startIndex !== -1) {
      if (startIndex + 1 < this.recordsList.length) {
        return this.recordsList[startIndex + 1].commitId;
      }
    }
    return null;
  };

  public previousCommitIdOf = (commitId: string): string | null => {
    const startIndex = this.indexOf(commitId);
    if (startIndex !== -1) {
      if (startIndex > 0) {
        return this.recordsList[startIndex - 1].commitId;
      }
    }
    return null;
  };

  public lastCommitId = (): string | null =>
    this.recordsList.length > 0
      ? this.recordsList[this.recordsList.length - 1].commitId
      : null;

  public getHistoryDelta = (
    fromCommitId: string,
    toCommitId?: string
  ): TableHistoryDelta<RecordType> | null => {
    const targetCommitId = toCommitId || this.lastCommitId();
    const startCommitIndex = this.indexOf(fromCommitId);
    if (targetCommitId === null || startCommitIndex === -1) {
      return null;
    }
    const cumulativeChangeByRecord: Map<
      Id,
      TableRecordChange<RecordType>
    > = new Map();
    const allRecordsChanges: TableRecordChange<RecordType>[] = [];
    const commitsIds: string[] = [];
    for (const operation of this.entries(fromCommitId, targetCommitId)) {
      commitsIds.push(operation.commitId);
      if (
        operation.__typename === HistoryOperationType.HISTORY_INIT ||
        operation.__typename === HistoryOperationType.HISTORY_FULL_TABLE_REFRESH
      ) {
        return null;
      } else if (
        operation.__typename === HistoryOperationType.TABLE_RECORD_CHANGE
      ) {
        allRecordsChanges.push(operation.change);
      } else if (
        operation.__typename === HistoryOperationType.HISTORY_MERGE_IN
      ) {
        allRecordsChanges.push(...operation.mergeDelta.changes);
      }
    }
    for (const change of allRecordsChanges) {
      if (change.__typename === TableOperationType.DELETE_RECORD) {
        const existingChange = cumulativeChangeByRecord.get(change.id);
        if (
          existingChange &&
          existingChange.__typename === TableOperationType.ADD_RECORD
        ) {
          // If we have added a record, and eventually deleted it, don't
          // even record the addition
          cumulativeChangeByRecord.delete(change.id);
        } else {
          cumulativeChangeByRecord.set(change.id, change);
        }
      } else if (change.__typename === TableOperationType.CHANGE_RECORD) {
        const existingChange = cumulativeChangeByRecord.get(change.id);
        if (existingChange) {
          if (existingChange.__typename === TableOperationType.ADD_RECORD) {
            const updatedInsert: AddRecord<RecordType> = {
              ...existingChange,
              row: {
                ...existingChange.row,
                ...change.changes
              }
            };
            cumulativeChangeByRecord.set(change.id, updatedInsert);
          } else if (
            existingChange.__typename === TableOperationType.CHANGE_RECORD
          ) {
            const updatedChange: ChangeRecord<RecordType> = {
              ...change,
              changes: {...existingChange.changes, ...change.changes}
            };
            cumulativeChangeByRecord.set(change.id, updatedChange);
          } else if (
            existingChange.__typename === TableOperationType.DELETE_RECORD
          ) {
            throw new Error('Change in record follows a record deletion');
          }
        } else {
          cumulativeChangeByRecord.set(change.id, change);
        }
      } else if (change.__typename === TableOperationType.ADD_RECORD) {
        const existingChange = cumulativeChangeByRecord.get(change.id);
        if (existingChange) {
          if (existingChange.__typename === TableOperationType.DELETE_RECORD) {
            const updateRecord: ChangeRecord<RecordType> = {
              __typename: TableOperationType.CHANGE_RECORD,
              id: change.id,
              changes: change.row,
              original: existingChange.original
            };
            cumulativeChangeByRecord.set(change.id, updateRecord);
          } else if (
            existingChange.__typename === TableOperationType.ADD_RECORD ||
            existingChange.__typename === TableOperationType.CHANGE_RECORD
          ) {
            throw new Error('Trying to add again an existing record.');
          }
        } else {
          cumulativeChangeByRecord.set(change.id, change);
        }
      }
    }

    if (cumulativeChangeByRecord.size > 0) {
      return {
        commitsIds,
        afterCommitId: fromCommitId,
        changes: Array.from(cumulativeChangeByRecord.values())
      };
    }
    return null;
  };

  public mergeInRemoteDelta = (
    historyDelta: TableMergeDelta<RecordType> | TableHistoryDelta<RecordType>
  ): null | {
    localChanges: TableRecordChange<RecordType>[];
    mergeChanges: TableRecordChange<RecordType>[];
    localCommitsIds: string[];
    mergeCommitsIds: string[];
  } => {
    const {afterCommitId} = historyDelta;
    if (this.indexOf(afterCommitId) === -1) {
      return null;
    }
    const localDelta = this.getHistoryDelta(afterCommitId);
    if (!localDelta) {
      return null;
    }
    const {mergeChanges, localChanges} = mergeInDeltaChanges(
      localDelta.changes,
      historyDelta.changes
    );
    const mergeCommitsIds: string[] = isTableMergeDelta(historyDelta)
      ? [...historyDelta.existingCommitsIds, ...historyDelta.mergedInCommitsIds]
      : isTableHistoryDelta(historyDelta)
      ? historyDelta.commitsIds
      : [];

    return {
      localChanges,
      mergeChanges,
      localCommitsIds: localDelta.commitsIds,
      mergeCommitsIds
    };
  };

  /**
   * You sent a client local delta to the server, and the server sends you
   * back the merge delta that is the result. Now you need to apply that merge
   * delta back into local.
   *
   * Local may also have gone a bit past since then.
   *
   * @param mergeDelta
   */
  public rebaseWithMergeDelta = (
    mergeDelta: TableMergeDelta<RecordType>
  ): TableRecordChange<RecordType>[] => {
    const {changes, afterCommitId, mergedInCommitsIds} = mergeDelta;
    const localDelta = this.getHistoryDelta(afterCommitId);
    if (!localDelta) {
      return [];
    }
    let lastMergedCommitId: string | null = null;
    for (let i = mergedInCommitsIds.length - 1; i >= 0; i--) {
      if (this.indexOf(mergedInCommitsIds[i]) !== -1) {
        lastMergedCommitId = mergedInCommitsIds[i];
        break;
      }
    }
    if (!lastMergedCommitId) {
      return [];
    }
    const afterMergeDelta = this.getHistoryDelta(lastMergedCommitId);
    if (afterMergeDelta) {
      const {mergeChanges: desiredChanges} = mergeInDeltaChanges(
        changes,
        afterMergeDelta.changes
      );
      return operationsToReachState(desiredChanges, localDelta.changes);
    } else {
      return operationsToReachState(changes, localDelta.changes);
    }
    const rebaseChanges: TableRecordChange<RecordType>[] = [];
    return rebaseChanges;
  };
}

function mergeInDeltaChanges<RecordType>(
  localChanges: TableRecordChange<RecordType>[],
  remoteChanges: TableRecordChange<RecordType>[]
): {
  mergeChanges: TableRecordChange<RecordType>[];
  localChanges: TableRecordChange<RecordType>[];
} {
  const localOperationsMap = new Map<Id, TableRecordChange<RecordType>>();
  const mergeChanges: TableRecordChange<RecordType>[] = [];
  for (const change of localChanges) {
    localOperationsMap.set(change.id, change);
  }

  for (const remoteChange of remoteChanges) {
    const localChange = localOperationsMap.get(remoteChange.id);
    if (localChange) {
      if (localChange.__typename === TableOperationType.DELETE_RECORD) {
        // we keep the local deletion, sorry mate
      } else if (localChange.__typename === TableOperationType.ADD_RECORD) {
        // errr, this is not expected really, duplicate id?
        throw new Error('Id already in use');
      } else if (localChange.__typename === TableOperationType.CHANGE_RECORD) {
        if (remoteChange.__typename === TableOperationType.DELETE_RECORD) {
          // We prevent the deletion if we have local changes
          // mergeChanges.push(remoteChange);
        } else if (
          remoteChange.__typename === TableOperationType.CHANGE_RECORD
        ) {
          const fullSetOfChanges = {
            ...remoteChange.changes,
            ...localChange.changes
          };
          mergeChanges.push({
            ...remoteChange,
            changes: fullSetOfChanges
          });
        } else if (remoteChange.__typename === TableOperationType.ADD_RECORD) {
          throw new Error('Duplicate record id on remote');
        }
      } else {
        mergeChanges.push(remoteChange);
      }
    } else {
      mergeChanges.push(remoteChange);
    }
  }
  return {mergeChanges, localChanges: Array.from(localOperationsMap.values())};
}

/**
 * You have the history of how you want your table to look like, and the history of the
 * table as it is now. This function gets you the list of operations you need to go to
 * on the current table to reach your desired state.
 *
 * @param targetHistory
 * @param sourceHistory
 */
function operationsToReachState<RecordType>(
  targetChanges: TableRecordChange<RecordType>[],
  sourceChanges: TableRecordChange<RecordType>[]
): TableRecordChange<RecordType>[] {
  const changesNeeded: TableRecordChange<RecordType>[] = [];
  const sourceChangesMap: Map<Id, TableRecordChange<RecordType>> = new Map();
  for (const sourceChange of sourceChanges) {
    sourceChangesMap.set(sourceChange.id, sourceChange);
  }
  for (const targetChange of targetChanges) {
    const sourceChange = sourceChangesMap.get(targetChange.id);
    if (!sourceChange) {
      changesNeeded.push(targetChange);
    } else {
      if (targetChange.__typename === TableOperationType.DELETE_RECORD) {
        if (
          sourceChange &&
          sourceChange.__typename !== TableOperationType.DELETE_RECORD
        ) {
          changesNeeded.push(targetChange);
        }
      } else if (targetChange.__typename === TableOperationType.ADD_RECORD) {
        if (sourceChange.__typename === TableOperationType.ADD_RECORD) {
          changesNeeded.push({
            __typename: TableOperationType.CHANGE_RECORD,
            changes: {...targetChange.row},
            id: targetChange.id,
            original: sourceChange.row
          });
        } else if (
          sourceChange.__typename === TableOperationType.CHANGE_RECORD
        ) {
          changesNeeded.push({
            __typename: TableOperationType.CHANGE_RECORD,
            changes: targetChange.row,
            id: targetChange.id,
            original: sourceChange.original
          });
        } else if (
          sourceChange.__typename === TableOperationType.DELETE_RECORD
        ) {
          changesNeeded.push(targetChange);
        } else {
          throw new Error(
            // @ts-expect-error throw in the future id we add new types
            `Unexpected table operation type: ${sourceChange.__typename}`
          );
        }
      } else if (targetChange.__typename === TableOperationType.CHANGE_RECORD) {
        if (sourceChange.__typename === TableOperationType.DELETE_RECORD) {
          changesNeeded.push({
            __typename: TableOperationType.ADD_RECORD,
            row: {...targetChange.original, ...targetChange.changes},
            id: targetChange.id
          });
        } else if (
          sourceChange.__typename === TableOperationType.CHANGE_RECORD
        ) {
          changesNeeded.push({
            __typename: TableOperationType.CHANGE_RECORD,
            id: targetChange.id,
            changes: {...targetChange.original, ...targetChange.changes},
            original: sourceChange.original
          });
        } else if (sourceChange.__typename === TableOperationType.ADD_RECORD) {
          changesNeeded.push({
            __typename: TableOperationType.CHANGE_RECORD,
            id: targetChange.id,
            changes: {...targetChange.original, ...targetChange.changes},
            original: sourceChange.row
          });
        } else {
          // @ts-expect-error throw in the future id we add new types
          `Unexpected table operation type: ${sourceChange.__typename}`;
        }
      } else {
        // @ts-expect-error throw in the future id we add new types
        throw new Error(`Unexpected change type: ${targetChange.__typename}`);
      }
    }
  }
  return changesNeeded;
}

class VersionedTableImpl<RecordType>
  implements ClientVersionedTable<RecordType> {
  private readonly table: Table<RecordType>;
  private historyEntries: TableVersionHistory<RecordType>;
  private readonly who?: Id;
  private inTxTbl: null | WritableTable<RecordType>;
  private _lastRemoteCommitId: null | string;

  constructor({table, tableHistory, who}: HistoryCreationProps<RecordType>) {
    this.who = who;
    this.table = table;
    this.historyEntries = tableHistory;
    this.inTxTbl = null;
    this._lastRemoteCommitId = null;
  }

  private writeToTbl = (body: TableTransactionBody<RecordType>) => {
    if (this.inTxTbl) {
      return body(this.inTxTbl);
    } else {
      return this.table.tx(body);
    }
  };

  public get lastRemoteCommitId() {
    return this._lastRemoteCommitId;
  }

  public get tbl() {
    return this.table;
  }

  public get syncTbl() {
    return this.table.syncTbl;
  }

  public branchVersionHistory = (toCommitId?: string) =>
    this.historyEntries.branch(toCommitId);

  public addRecord = async (recordId: Id, record: RecordType) => {
    return this.writeToTbl(async tbl => {
      await tbl.setRecord(recordId, record);
      const addOp: Omit<RecordChangeOperation<RecordType>, 'commitId'> = {
        __typename: HistoryOperationType.TABLE_RECORD_CHANGE,
        change: {
          __typename: TableOperationType.ADD_RECORD,
          row: record,
          id: recordId
        },
        when: new Date(),
        who: this.who
      };
      const newRecord = await tbl.getRecord(recordId);
      if (!newRecord) {
        throw new Error('Unable to add new record in table');
      }
      await this.historyEntries.push({
        ...addOp,
        commitId: commitIdForOperation(addOp)
      });
      return newRecord;
    });
  };

  public updateRecord = async (
    recordId: Id,
    recordChanges: Partial<RecordType>
  ) => {
    return this.writeToTbl(async tbl => {
      const originalRecord = await this.table.getRecord(recordId);
      if (!originalRecord) {
        throw new Error('Record to update not found');
      }
      const changeOp: Omit<RecordChangeOperation<RecordType>, 'commitId'> = {
        __typename: HistoryOperationType.TABLE_RECORD_CHANGE,
        change: {
          __typename: TableOperationType.CHANGE_RECORD,
          id: recordId,
          original: originalRecord,
          changes: recordChanges
        },
        when: new Date(),
        who: this.who
      };
      await tbl.setRecord(recordId, {...originalRecord, ...recordChanges});
      const updatedRecord = tbl.getRecord(recordId);
      if (!updatedRecord) {
        throw new Error('Unable to update record in table');
      }
      await this.historyEntries.push({
        ...changeOp,
        commitId: commitIdForOperation(changeOp)
      });
      return updatedRecord;
    });
  };

  public deleteRecord = async (recordId: Id) => {
    try {
      await this.writeToTbl(async tbl => {
        const originalRecord = await this.table.getRecord(recordId);
        if (!originalRecord) {
          return false;
        }
        const deleteOp: Omit<RecordChangeOperation<RecordType>, 'commitId'> = {
          __typename: HistoryOperationType.TABLE_RECORD_CHANGE,
          change: {
            __typename: TableOperationType.DELETE_RECORD,
            id: recordId,
            original: originalRecord
          },
          when: new Date(),
          who: this.who
        };
        await tbl.deleteRecord(recordId);
        await this.historyEntries.push({
          ...deleteOp,
          commitId: commitIdForOperation(deleteOp)
        });
        return true;
      });
    } catch (err) {
      // Do nothing or throw? Probably throw
    }
    return false;
  };

  public bulkLoad = async ({
    commitId,
    data: allRecords
  }: VersionedTablePopulationData<RecordType>) => {
    try {
      const existingIds = await this.table.allKeys();
      await this.writeToTbl(async tbl => {
        const updatedIds: Set<Id> = new Set();
        for (const [recordId, updatedRecord] of allRecords) {
          updatedIds.add(recordId);
          await tbl.setRecord(recordId, updatedRecord);
        }
        for (const existingId of existingIds) {
          if (!updatedIds.has(existingId)) {
            await tbl.deleteRecord(existingId);
          }
        }
        const sampleRows = allRecords.slice(0, 500);
        this.historyEntries.clear();
        await this.historyEntries.push({
          __typename: HistoryOperationType.HISTORY_FULL_TABLE_REFRESH,
          sampleRows: sampleRows.map(row => row[1]),
          nRows: allRecords.length,
          when: new Date(),
          commitId,
          who: this.who
        });
        this._lastRemoteCommitId = commitId;
      });
    } catch (err) {
      // Do nothing
    }
  };

  public tx = async (txBody: HistoryTransaction<RecordType>) => {
    try {
      const result = await this.tbl.tx(tbl => {
        this.inTxTbl = tbl;
        return txBody(this);
      });
      this.inTxTbl = null;
      return result;
    } catch (err) {
      this.inTxTbl = null;
      throw err;
    }
  };

  public getHistoryDelta = (fromCommitId: string, toCommitId?: string) =>
    this.historyEntries.getHistoryDelta(fromCommitId, toCommitId);

  public mergeWith = async (
    historyDelta: TableHistoryDelta<RecordType>
  ): Promise<HistoryMergeOperation<RecordType> | null> => {
    const mergeResult = this.historyEntries.mergeInRemoteDelta(historyDelta);

    if (mergeResult === null) {
      return null;
    }
    const mergeOp = await this.writeToTbl(async () => {
      await this.applyRecordOperationsToDB(mergeResult.mergeChanges);
      const baseMergeOp: Omit<HistoryMergeOperation<RecordType>, 'commitId'> = {
        __typename: HistoryOperationType.HISTORY_MERGE_IN,
        mergeDelta: {
          changes: mergeResult.mergeChanges,
          afterCommitId: historyDelta.afterCommitId,
          existingCommitsIds: mergeResult.localCommitsIds,
          mergedInCommitsIds: mergeResult.mergeCommitsIds
        },
        when: new Date(),
        who: this.who
      };
      const mergeOp = {
        ...baseMergeOp,
        commitId: commitIdForOperation(baseMergeOp)
      };
      await this.historyEntries.push(mergeOp);
      return mergeOp;
    });

    const deltaForRemote = this.historyEntries.getHistoryDelta(
      historyDelta.afterCommitId
    );
    const changesForRemote = deltaForRemote ? deltaForRemote.changes : [];
    return {
      ...mergeOp,
      mergeDelta: {...mergeOp.mergeDelta, changes: changesForRemote}
    };
  };

  private applyRecordOperationsToDB = async (
    recordOperations: TableRecordChange<RecordType>[]
  ) =>
    this.writeToTbl(async tbl => {
      for (const recordOperation of recordOperations) {
        if (recordOperation.__typename === TableOperationType.DELETE_RECORD) {
          await tbl.deleteRecord(recordOperation.id);
        } else if (
          recordOperation.__typename === TableOperationType.CHANGE_RECORD
        ) {
          const currentVal = await tbl.getRecord(recordOperation.id);
          if (!currentVal) {
            throw new Error('Record to update not found');
          }
          await tbl.setRecord(recordOperation.id, {
            ...currentVal,
            ...recordOperation.changes
          });
        } else if (
          recordOperation.__typename === TableOperationType.ADD_RECORD
        ) {
          await tbl.setRecord(recordOperation.id, recordOperation.row);
        }
      }
    });

  public applyMerge = async (
    mergeEntry: HistoryMergeOperation<RecordType>
  ): Promise<void> => {
    const {mergeDelta, commitId} = mergeEntry;
    if (this.historyEntries.indexOf(mergeDelta.afterCommitId) === -1) {
      return;
    }
    const changesNeeded = this.historyEntries.rebaseWithMergeDelta(mergeDelta);
    await this.writeToTbl(async () => {
      if (changesNeeded.length > 0) {
        await this.applyRecordOperationsToDB(changesNeeded);
      }
      const allMergeCommitsIds = [
        ...mergeDelta.existingCommitsIds,
        ...mergeDelta.mergedInCommitsIds
      ];
      const existingCommitsIds: string[] = [];
      const mergedInCommitsIds: string[] = [];
      for (const mergeCommitId of allMergeCommitsIds) {
        if (this.historyEntries.indexOf(mergeCommitId) !== -1) {
          existingCommitsIds.push(mergeCommitId);
        } else {
          mergedInCommitsIds.push(mergeCommitId);
        }
      }
      this._lastRemoteCommitId = commitId;
      await this.historyEntries.push({
        __typename: HistoryOperationType.HISTORY_MERGE_IN,
        mergeDelta: {
          changes: changesNeeded,
          afterCommitId: mergeDelta.afterCommitId,
          existingCommitsIds,
          mergedInCommitsIds
        },
        when: new Date(),
        who: this.who,
        commitId
      });
    });
  };

  public lastCommitId = (): string => {
    const commitId = this.historyEntries.lastCommitId();
    if (commitId === null) {
      throw new Error('The history is empty');
    }
    return commitId;
  };

  public firstCommitId = (): string => {
    if (this.historyEntries.length === 0) {
      throw new Error('EMpty history');
    }
    return this.historyEntries.getByIndex(0).commitId;
  };

  public nextCommitIdOf = (commitId: string): string | null =>
    this.historyEntries.nextCommitIdOf(commitId);

  public prevCommitIdOf = (commitId: string): string | null =>
    this.historyEntries.previousCommitIdOf(commitId);
}

export function internalCreateVersionedTable<RecordType>(
  props: HistoryCreationProps<RecordType>
) {
  return new VersionedTableImpl(props);
}

export async function createMappedVersioningHistoryList<RecordType>(
  options: TableHistoryFactoryOptions = {}
) {
  const {who, fromCommitId} = options;
  const initOp: Omit<HistoryInit, 'commitId'> = {
    __typename: HistoryOperationType.HISTORY_INIT,
    when: new Date(),
    who
  };
  const tableHistory = new MemoryTableVersionHistory<RecordType>([
    {...initOp, commitId: fromCommitId || commitIdForOperation({...initOp})}
  ]);
  return tableHistory;
}
