import {
  BaseCreateVersionedTableProps,
  HistoryMergeOperation,
  HistoryOperationType,
  TableHistoryDelta,
  VersionedTable,
  VersionedTableCloneResult,
  VersionedTablesChannel
} from './types';
import {emptyVersionedTable} from './factories';

export async function push<RecordType>(
  versionedTable: VersionedTable<RecordType>,
  channel: VersionedTablesChannel
): Promise<void> {
  try {
    if (versionedTable.lastRemoteCommitId === null) {
      return;
    }
    const delta = versionedTable.getHistoryDelta(
      versionedTable.lastRemoteCommitId
    );
    if (!delta) {
      return;
    }
    const mergeDelta = await channel.pushChanges(
      versionedTable.tbl.tableName,
      delta
    );
    if (mergeDelta) {
      await versionedTable.applyMerge(mergeDelta);
    }
    return;
  } catch (err) {
    // Do nothing
    console.log(err);
  }
}

export async function pull<RecordType>(
  versionedTable: VersionedTable<RecordType>,
  channel: VersionedTablesChannel
): Promise<HistoryMergeOperation<RecordType> | null> {
  try {
    const lastCommitId = versionedTable.lastRemoteCommitId;
    if (lastCommitId) {
      const mergeOp = await channel.pullChanges<RecordType>(
        versionedTable.tbl.tableName,
        lastCommitId
      );
      if (mergeOp) {
        await versionedTable.applyMerge(mergeOp);
      }
    } else {
      const res = await channel.cloneTable<RecordType>(
        versionedTable.tbl.tableName
      );
      await versionedTable.bulkLoad({
        data: res.rows,
        commitId: res.lastCommitId
      });
    }
  } catch (err) {
    // noop
  }
  return null;
}

export interface CloneTableProps<RecordType>
  extends BaseCreateVersionedTableProps<RecordType> {
  fromCommitId: string;
}

export async function cloneTable<RecordType>(
  props: CloneTableProps<RecordType>,
  channel: VersionedTablesChannel
): Promise<VersionedTable<RecordType>> {
  const [versionedTable, initialData] = await Promise.all([
    emptyVersionedTable<RecordType>(props),
    channel.cloneTable<RecordType>(props.tableName)
  ]);
  if (initialData.rows.length > 0) {
    await versionedTable.bulkLoad({
      data: initialData.rows,
      commitId: initialData.lastCommitId
    });
  }
  return versionedTable;
}

class InMemoryVTChannel implements VersionedTablesChannel {
  private _serverVersionedTable: VersionedTable<any>;

  constructor(serverVT: VersionedTable<any>) {
    this._serverVersionedTable = serverVT;
  }

  pushChanges = async <RecordType>(
    tableName: string,
    delta: TableHistoryDelta<RecordType>
  ) => {
    if (tableName !== this._serverVersionedTable.tbl.tableName) {
      throw new Error(
        `This channel is for table ${this._serverVersionedTable.tbl.tableName} only`
      );
    }
    const mergeRes = await this._serverVersionedTable.mergeWith(delta);
    return mergeRes;
  };

  pullChanges = async <RecordType>(tableName: string, fromCommitId: string) => {
    if (tableName !== this._serverVersionedTable.tbl.tableName) {
      throw new Error(
        `This channel is for table ${this._serverVersionedTable.tbl.tableName} only`
      );
    }
    const delta = await this._serverVersionedTable.getHistoryDelta(
      fromCommitId
    );
    if (delta) {
      const mergeRes: HistoryMergeOperation<any> = {
        __typename: HistoryOperationType.HISTORY_MERGE_IN,
        when: new Date(),
        mergeDelta: {
          afterCommitId: fromCommitId,
          mergedInCommitsIds: [],
          existingCommitsIds: delta.commitsIds,
          changes: delta.changes
        },
        commitId: this._serverVersionedTable.lastCommitId()
      };
      return mergeRes as HistoryMergeOperation<RecordType>;
    }
    return null;
  };

  cloneTable = async <RecordType>(tableName: string) => {
    if (tableName !== this._serverVersionedTable.tbl.tableName) {
      throw new Error(
        `This channel is for table ${this._serverVersionedTable.tbl.tableName} only`
      );
    }
    const commitId = this._serverVersionedTable.lastCommitId();
    const allRecords = await this._serverVersionedTable.tbl.getRecords();
    return {
      rows: allRecords,
      lastCommitId: commitId
    } as VersionedTableCloneResult<RecordType>;
  };
}

export const createInMemoryVTChannel = (
  serverVersionedTable: VersionedTable<any>
): VersionedTablesChannel => {
  return new InMemoryVTChannel(serverVersionedTable);
};
