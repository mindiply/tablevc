import {
  BaseCreateVersionedTableProps,
  ClientVersionedTable,
  HistoryMergeOperation,
  Id,
  VersionedTable,
  VersionedTablesChannel
} from './types';
import {emptyVersionedTable} from './factories';

export async function push<RecordType>(
  versionedTable: ClientVersionedTable<RecordType>,
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
  versionedTable: ClientVersionedTable<RecordType>,
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
        data: res.rows.map(row => [
          (row[versionedTable.tbl.primaryKey] as unknown) as Id,
          row
        ]),
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
      data: initialData.rows.map(row => [
        (row[props.primaryKey] as unknown) as Id,
        row
      ]),
      commitId: initialData.lastCommitId
    });
  }
  return versionedTable;
}
