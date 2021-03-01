# tablevc - Table versin control

Small library to keep synchronized a table of records between
two different sites, one of the sites designed as the central
server. Typescript powered.

# The gist

Given a record type

    interface TstRecordType {
        _id: Id;
        name: string;
        when: Date;
        amount: number;
        children: Id[];
        isTrue: boolean;
    }

create a local table instance (by default powered by a memory map):

    const serverTable = await createVersionedTable<TstRecordType>();
    await serverTable.addRecord('TEST1', testRecord1);
    await serverTable.addRecord('TEST2', testRecord2);
    
some time later a client requests the contents of the table
    
    async function handleClientRequest() {
        const records = await serverTable.getRecords()
        return {records, commitId: serverTable.lastCommitId()}
    }

whilst on the client

    async function initializeTable(): VersionedTable<TstRecordType> {
        const {records, commitId} = await requestTableData();
        saveLastCommonCommitId(commitId);
        const localTable = await createVersionedTable({
          initialData: {
            commitId,
            idExtract: (record: TstRecordType) => record._id,
            data: records
          }
        });
    }

somewhere else on the client
    
    async function changeAmount(id, amount) {
        await localTable.changeRecord(
            id,
            {amount}
        );
        pushChanges(localTable.getHistoryDelta(
            getLastCommonCommitId(commitId)
        )).then().catch();
    }

the idea being you apply changes locally, and the synchronization back
is handled within pushChanges.

In general compatible record level changes (e.g. different fields updated
concurrently) work as expected. When a conflict arises, in general the
server version will emerge victorious. For example if locally I change
record A but on the server record A has been deleted, the result once
the branches are reconciled is that the deletion stays.

