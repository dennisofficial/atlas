# @dltech/atlas-control

The control-plane library. It holds the thread record, the sessions, the leases, the inbox, the
subscriptions and the routines. The API and the Trigger.dev worker run it. It is the only writer of
a thread's event log.

## Owns

- `ControlPlane`: every write and read of the control plane, over a store port.
- The session lifecycle: create, title, rename, archive, mark read, and the peer and teammate
  messages.
- The thread record: the hash-chained event log, the reads, the blobs and the plugin views.
- The holder leases, the claims, the pod wakes and the host presence.
- The inbox, the subscriptions and their endings.
- The terminals, the worktree changes and the change-blob garbage collection.
- The routines: the rows, the runs and the due check.
- The sandbox run rows and the compute sum.
- Two store adapters: `PostgresControlStore`, and `InMemoryControlStore` for a spec.

## Does not own

- The event ids and the event body shapes. `@dltech/atlas-core` owns them.
- The HTTP procedures and the SSE stream service. `apps/api` and the agent host own them.
- The trigger.dev schedules. `apps/trigger` owns them.
- The database client and the migrations. `@dltech/atlas-db` owns them.

## Entry points

| Import                           | Use it for                                                                 |
| -------------------------------- | -------------------------------------------------------------------------- |
| `@dltech/atlas-control`          | `ControlPlane`, the store port, the refusal kinds and the routine service. |
| `@dltech/atlas-control/postgres` | The Postgres store and the session write and view helpers.                 |
| `@dltech/atlas-control/testing`  | `InMemoryControlStore`, the conformance suites and a fake change store.    |

## Capabilities

### Run a session

- `createSession`, `createSessionWithMessage`, `setSessionModel`, `renameSession`,
  `titleUntitledSession`, `setSessionArchived`, `markSessionRead`.
- `listSessions`, `listSessionDigests`, `readSession`, `sessionsOf`, `readSessionView`,
  `readSessionBusy`.
- `spawnPeer`, `messagePeer`, `messageTeammate`, `reportToSpawner`, `podPeersPlaced`.
- `setSandboxInstanceId`, `setSandboxStatus`, `recordPodDesired`, `recordPodApplied`,
  `recordPodFailed`, `recordPodWaiting`.

### Append to the thread record

- `createThread({ sessionId, threadId })`, `head({ threadId })`, `readThread({ threadId })`.
- `append({ threadId, epoch, events, blobs? })`: returns an `AppendOutcome`. A refused append
  carries its `refusal` and the current head.
- `readEvents({ threadId, afterSeq, limit, visible, hiddenTypes?, maxBytes? })`, `readBlob`,
  `blobReferencedBy`. `MAX_READ_LIMIT` and `MAX_SESSION_LIST_LIMIT` cap a read.
- `AppendHook`, `ChangeFeed`: the hooks that an append calls, and the change pointer it sends.

### Read a session view

- `pricedView({ at, value, compute? })`: the priced `SessionViewOutput` of a control session value.
- `sessionSummaryOf({ digest, now })`: returns the `SessionSummary` of a session digest.
- `idleReleaseGuardOf({ entries, failure, wantsHolder })`: returns an `IdleReleaseGuard` with the
  inbox head and the reasons.

### Hold a lease

- `grant`, `revoke`, `currentLease`, `claimNext`, `leasesHeldBy`, `clearStartAttempts`, `wake`,
  `hostPresent`.
- `LeaseConflictError`, `MainThreadOnlyKindError`, `UnknownThreadError`, `SeqConflictError`: the
  errors a caller must read.

### Post, subscribe and open a terminal

- `post`, `withdraw`, `readInbox`, `readInboxEntry`; `INBOX_KIND_WITHDRAW`,
  `withdrawPayloadOf`.
- `subscribe`, `unsubscribe`, `endSubscriptions`, `listSubscriptions`,
  `DEFAULT_SUBSCRIPTION_TTL_MS`.
- `listTerminals`, `readTerminal`, `createTerminal`, `renameTerminal`, `markTerminalOpen`,
  `endTerminal`, `endTerminals`, `deleteTerminal`.

### Track the worktree changes

- `upsertChanges`, `readChanges`, `readChangeFile`, `changesUpdatedAt`, `changeBlobsPresent`,
  `changeBlobsUnreferenced`, `deleteChangeBlobs`.
- `changeHashOf(content)`, `changeBlobKey(hash)`, `ChangeContentStore`.
- `runChangesGc({ store, content, graceMs? })`: removes the change blobs that no row uses.
  `CHANGES_GC_GRACE_MS` and `CHANGES_GC_ROW_LIMIT` set the default.

### Record a sandbox run

- `sandboxRunRecorderOf({ store, ids, now })`: a `SandboxRunRecorder` with `open`, `close`, `meter`
  and `compute`, over a `SandboxRunStore`. `compute` returns the `SandboxCompute`.

### Run a routine

- `createRoutine`, `updateRoutine`, `deleteRoutine`, `listRoutines`, `readRoutine`,
  `listRoutineRuns`, `runRoutine`.
- `routineCreateOf(plane)`, `routineGetOf`, `routineListOf`, `routineUpdateOf`, `routineRemoveOf`,
  `routineRunNowOf`, `routineRunsOf`: the same operations over a `RoutinePlane`.
- `MINIMUM_ROUTINE_GAP_MINUTES`, `RoutineInvalidError`, `RoutineNotFoundError`.

### Use a store

- `ControlStorePort`, `ControlTx`, `StoredEvent`: the port that a store adapter implements.
- `PostgresControlStore`, `controlTxOf(tx)`: the Postgres adapter, and its transaction wrapper.
- `InMemoryControlStore`: the in-memory adapter for a spec.
- `describeControlPlaneConformance(params)`, `describeControlPlaneSessions`,
  `describeControlPlaneClaims`, `describeControlPlanePeers`: the shared spec suites.
- `FakeChangeContentStore`: a change content store that keeps the blobs in memory.

## Usage

From `apps/trigger/src/trigger/routine/routine-graph.ts`:

```ts
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { db } from '@dltech/atlas-db'

export const graphOf = () => {
  const store = new PostgresControlStore(db)
  return { store, plane: new ControlPlane({ store }) }
}
```

From `apps/api/src/trigger/changes/changes-gc.task.ts`:

```ts
import {
  ControlPlane,
  runChangesGc,
  type ChangesGcContent,
  type ChangesGcStore,
} from '@dltech/atlas-control'

const store: ChangesGcStore = new ControlPlane({ store: new PostgresControlStore(db) })
const summary = await runChangesGc({ store, content })
```

## Rules

- Write through `ControlPlane`. Use a function from `/postgres` only for an operation that the plane
  does not expose.
- Do not import `/postgres` in a browser or a client. It needs a database connection.
- Implement `ControlStorePort` for a new store, and run the conformance suites against it.
- Give `ControlPlane` a `clock` in a spec. Do not use the real clock in a test.
- Read an append refusal from `AppendOutcome`. Do not throw for a refused append.

## See also

- `docs/v2/architecture.md` describes the control plane and the pod.
- `docs/decisions/0025-v2-connection-bound-leases.md` gives the lease rules.
