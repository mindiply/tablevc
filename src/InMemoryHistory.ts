import jsSHA from 'jssha';
import {
  AddRecord,
  ChangeRecord,
  HistoryFactoryOptions,
  HistoryInit,
  HistoryMergeOperation,
  HistoryOperationType,
  HistoryPopulationData,
  HistoryTransaction,
  Id,
  isTableHistoryDelta,
  isTableMergeDelta,
  RecordChangeOperation,
  Table,
  TableFactory,
  TableHistory,
  TableHistoryDelta,
  TableHistoryEntry,
  TableMergeDelta,
  TableOperationType,
  TableRecordChange,
  TableTransactionBody,
  WritableTable
} from './types';

export interface HistoryCreationProps<RecordType> {
  tableFactory: TableFactory<RecordType>;
  who?: Id;
}

function commitIdForOperation(
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

class MappedHistoriesEntriesList<RecordType> {
  private recordsList: TableHistoryEntry<RecordType>[];
  private recordsById: Map<string, number>;

  constructor(initialElements: TableHistoryEntry<RecordType>[] = []) {
    this.recordsList = initialElements;
    this.recordsById = new Map(
      initialElements.map((record, index) => [record.commitId, index])
    );
  }

  public get length() {
    return this.recordsList.length;
  }

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

  public push = (entry: TableHistoryEntry<RecordType>): number => {
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
    let cumulativeChangeByRecord: Map<
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
        if (existingChange) {
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
              record: {
                ...existingChange.record,
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
              changes: change.record,
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
    const {
      changes,
      afterCommitId,
      existingCommitsIds,
      mergedInCommitsIds
    } = mergeDelta;
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
          remoteChanges.push(remoteChange);
        } else if (
          remoteChange.__typename === TableOperationType.CHANGE_RECORD
        ) {
          const fullSetOfChanges = {
            ...remoteChange.changes,
            ...localChange.changes
          };
          remoteChanges.push({
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
      throw new Error('We only deal with record changes');
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
            changes: {...targetChange.record},
            id: targetChange.id,
            original: sourceChange.record
          });
        } else if (
          sourceChange.__typename === TableOperationType.CHANGE_RECORD
        ) {
          changesNeeded.push({
            __typename: TableOperationType.CHANGE_RECORD,
            changes: targetChange.record,
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
            record: {...targetChange.original, ...targetChange.changes},
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
            original: sourceChange.record
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

class InMemoryHistory<RecordType> implements TableHistory<RecordType> {
  private readonly table: Table<RecordType>;
  private historyEntries: MappedHistoriesEntriesList<RecordType>;
  private readonly who?: Id;
  private inTxTbl: null | WritableTable<RecordType>;

  constructor({tableFactory, who}: HistoryCreationProps<RecordType>) {
    this.who = who;
    this.table = tableFactory();
    const initOp: Omit<HistoryInit, 'commitId'> = {
      __typename: HistoryOperationType.HISTORY_INIT,
      when: new Date(),
      who
    };
    this.historyEntries = new MappedHistoriesEntriesList<RecordType>([
      {...initOp, commitId: commitIdForOperation({...initOp})}
    ]);
    this.inTxTbl = null;
  }

  private writeToTbl = (body: TableTransactionBody<RecordType>) => {
    if (this.inTxTbl) {
      return body(this.inTxTbl);
    } else {
      return this.table.tx(body);
    }
  };

  public get tbl() {
    return this.table;
  }

  public get syncTbl() {
    return this.table.syncTbl;
  }

  public addRecord = async (recordId: Id, record: RecordType) => {
    try {
      const addOp: Omit<RecordChangeOperation<RecordType>, 'commitId'> = {
        __typename: HistoryOperationType.TABLE_RECORD_CHANGE,
        change: {
          __typename: TableOperationType.ADD_RECORD,
          record,
          id: recordId
        },
        when: new Date(),
        who: this.who
      };
      const newRecord = await this.writeToTbl(async tbl => {
        await tbl.setRecord(recordId, record);
        return tbl.getRecord(recordId);
      });
      if (!newRecord) {
        throw new Error('Unable to add new record in table');
      }
      this.historyEntries.push({
        ...addOp,
        commitId: commitIdForOperation(addOp)
      });
      return newRecord;
    } catch (err) {
      // Do nothing or throw? Probably throw
      throw err;
    }
  };

  public updateRecord = async (
    recordId: Id,
    recordChanges: Partial<RecordType>
  ) => {
    try {
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
      const updatedRecord = await this.writeToTbl(async tbl => {
        await tbl.setRecord(recordId, {...originalRecord, ...recordChanges});
        return tbl.getRecord(recordId);
      });
      if (!updatedRecord) {
        throw new Error('Unable to update record in table');
      }
      this.historyEntries.push({
        ...changeOp,
        commitId: commitIdForOperation(changeOp)
      });
      return updatedRecord;
    } catch (err) {
      // Do nothing or throw? Probably throw
      throw new Error('Error while updating a record');
    }
  };

  public deleteRecord = async (recordId: Id) => {
    try {
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
      await this.writeToTbl(tbl => tbl.deleteRecord(recordId));
      this.historyEntries.push({
        ...deleteOp,
        commitId: commitIdForOperation(deleteOp)
      });
      return true;
    } catch (err) {
      // Do nothing or throw? Probably throw
    }
    return false;
  };

  public refreshTable = async ({
    commitId,
    data: allRecords,
    idExtract
  }: HistoryPopulationData<RecordType>) => {
    try {
      const existingIds = await this.table.allKeys();
      await this.writeToTbl(async tbl => {
        const updatedIds: Set<Id> = new Set();
        for (const updatedRecord of allRecords) {
          const recordId = idExtract(updatedRecord);
          updatedIds.add(recordId);
          await tbl.setRecord(recordId, updatedRecord);
        }
        for (const existingId of existingIds) {
          if (!updatedIds.has(existingId)) {
            await tbl.deleteRecord(existingId);
          }
        }
      });
      const sampleRows = allRecords.slice(0, 500);
      this.historyEntries.clear();
      this.historyEntries.push({
        __typename: HistoryOperationType.HISTORY_FULL_TABLE_REFRESH,
        sampleRows,
        nRows: allRecords.length,
        when: new Date(),
        commitId,
        who: this.who
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
  ): Promise<TableMergeDelta<RecordType> | null> => {
    const mergeResult = this.historyEntries.mergeInRemoteDelta(historyDelta);

    if (mergeResult === null) {
      return null;
    }
    await this.applyRecordOperationsToDB(mergeResult.mergeChanges);
    const mergeOp: Omit<HistoryMergeOperation<RecordType>, 'commitId'> = {
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
    this.historyEntries.push({
      ...mergeOp,
      commitId: commitIdForOperation(mergeOp)
    });
    return {
      mergedInCommitsIds: mergeResult.mergeCommitsIds,
      existingCommitsIds: mergeResult.localCommitsIds,
      afterCommitId: historyDelta.afterCommitId,
      changes: [...mergeResult.localChanges, ...mergeResult.mergeChanges]
    };
  };

  private applyRecordOperationsToDB = async (
    recordOperations: TableRecordChange<RecordType>[]
  ) =>
    this.table.tx(async tbl => {
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
          await tbl.setRecord(recordOperation.id, recordOperation.record);
        }
      }
    });

  public applyMerge = async (
    mergeDelta: TableMergeDelta<RecordType>
  ): Promise<void> => {
    const changesNeeded = this.historyEntries.mergeInRemoteDelta(mergeDelta);
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

export async function InMemoryHistoryFactory<RecordType>(
  tableFactory: TableFactory<RecordType>,
  {who, populationData}: HistoryFactoryOptions<RecordType>
): Promise<TableHistory<RecordType>> {
  const history = new InMemoryHistory({tableFactory, who});
  if (populationData) {
    await history.refreshTable(populationData);
  }
  return history;
}
