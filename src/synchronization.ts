import {
  ClientVersionedTable,
  HistoryMergeOperation,
  PushToServerChannel,
  TableHistoryDelta
} from './types';

export async function push<RecordType>(
  versionedTable: ClientVersionedTable<RecordType>,
  channel: PushToServerChannel<RecordType>
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
    const mergeDelta = await channel(delta);
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
  delta: TableHistoryDelta<RecordType>
): Promise<HistoryMergeOperation<RecordType> | null> {
  try {
    const mergeOp = await versionedTable.mergeWith(delta);
    return mergeOp;
  } catch (err) {
    // noop
  }
  return null;
}
