# @dltech/atlas-host

The agent-host library. It runs beside the API, claims sessions from the control plane, holds the
lease, and calls the sandbox daemon remotely. The record is the source of truth; the holder keeps
only what it can rebuild or drop.

## Owns

- The claim loop: `SessionHolder` claims a session, holds it, and settles the lease.
- Remote calls to the daemon: the link, the handshake, the replay and the fencing.
- The daemon-backed ports: filesystem, agent filesystem and process.
- The record adapter and its cache, and the once-ledger of a session.
- The live step buffer, which flushes a streamed answer to the clients.
- The change snapshotter, and the inbox intake of a held session.
- The context mirror, which keeps a held session's context folder in the content store and index.
- Seeding a session's context folder from the files a spawner attached, before its first turn.
- Terminal and panel demand, which keep a pod awake.
- The drain budget, and the errors a lost sandbox raises.

## Does not own

- The loop that runs a turn: `@dltech/atlas-agent`.
- The wire schemas it exchanges: `@dltech/atlas-protocol`.
- The lease table and the inbox rows: `@dltech/atlas-control`.
- The sandbox provider and the daemon bundle: `apps/api` and `apps/daemon`.

## Entry points

| Import                       | Use it for                                                        |
| ---------------------------- | ----------------------------------------------------------------- |
| `@dltech/atlas-host`         | The holder, remote calls, daemon ports, drain and errors.         |
| `@dltech/atlas-host/testing` | Fault injection, memory stores and two shared conformance suites. |

## Capabilities

### Hold a session

- `SessionHolder`: `start()`, `drain()`, `heldIds()`, `hostId()`, `ring()`, `podCalls()`,
  `demandOf()` and `discard()`.
- `SessionHolderArgs`: presence, the control plane, the bus, the timers, the runtime factory, the
  ids, the commands and their pod and control handlers. It also takes the optional control, MCP,
  operator, changes, context mirror, notify and turn-ended hooks, the log, the pod peers, the
  terminal and panel demand, and the two start-error classifiers. `NotifyDispatch` tells another
  process that a turn ended or parked. `ParkArchivedPod` sleeps an archived pod. `TurnEndedHook`
  reports an ended turn.
- `PodCalls`, `PodCallOutcome`: invoke an op on a held session, or listen to its frames.
- `podControlOf(...)`: the control-plane client that a plugin's `PodControl` reaches.
- `SessionRuntime.classifier`, `SessionRuntime.classifierStatus`: the core `ClassifierPort` of a
  held session, wired into `ctx.classifier` for a plugin. The runtime factory builds the client.
- `SessionRuntime.quality`: the optional `QualityStagePort` the runtime factory builds, so a held
  session and every child it spawns review their writes through one stage.
- `placeContextFiles`, `contextFilesPlacerOf`: write the files a spawner attached into the context
  folder of a session, before its first turn.
- The holder holds a clean sub-agent ending while a sibling from the same spawn step still runs, then
  wakes the parent once the last member ends. A compacted log cannot lose the group.

### Call the daemon

- `RemoteCalls`: the client of the daemon link. `open`, `ready`, `invoke`, `ack`, `ackScope`,
  `handoff` and `close`. It reports each `EventFrame` to its listeners.
- `WorkspaceGate`, `POD_WAIT_INTERRUPTED`, `WorkspaceGateOutcome`: hold a tool call until the
  workspace prepare settles, and fail the call when the wait is interrupted.
- `webSocketConnector({url})`, `DaemonConnector`, `DaemonSocket`: connect to the daemon.
- `newKey()`, `systemTimers`, `CallTimers`: a call key and the timers the link uses.
- `ScopedToolDispatcher`, `runInCallScope`, `scopeKeyOf`, `markDispatched`, `nextKey`: bind a call
  to one scope so a retry does not run it twice.

### Reach the sandbox through a port

- `DaemonFileSystemPort`, `DaemonAgentFileSystemPort`, `DaemonProcessPort`: the daemon-backed ports.
- `DEFAULT_SANDBOX_COMMANDS`: the command names the sandbox resolves.

### Keep the record

- `SessionRecord`: the `AgentRecordPort` and `ModelContextPort` over the control plane.
- `RecordCache`: keeps the events of a thread in memory while the holder holds the session.
- `V2OnceLedger`: the v2 `OnceLedger`, which reads the cached log.
- `LeaseLostError`, `RecordCorruptionError`: the two failures a record raises.
- `InboxIntake`, `INBOX_KIND_STOP`: turn the inbox into the agent's input.

### Stream and observe

- `LiveStepBuffer`, `LIVE_FLUSH_MS`, `LIVE_FLUSH_BYTES`, `LIVE_STEP_CAP_BYTES`: buffer the output
  of a step and flush it to the live channel.
- `ChangesSnapshotter`, `fingerprintOf`, `changeCheckoutId`, `changeRepoOf`: snapshot the files a
  session changed. The checkout id is `sha256(sessionId, repo, realpath(worktreePath))`, so it is
  session-scoped: one worktree path keeps two rows for two sessions.
- `TerminalDemand`, `PanelDemand`, `PANEL_HOLD_TTL_MS`: keep a pod awake for a terminal or panel.
- `ContextMirror`: the rescanner that keeps a held session's context folder in the content store and
  its index, one file at a time, and skips the removal of a row its scan could not see.

### Route a pod call to its holder

- `SessionHolder.podRouter()`: a `PodRouter` (`PodReach`, `EPodReach`, `PodFollowClose`). `reach`
  decides the route. `invoke` holds a panel when `waitForHolder` is set. `follow` streams frames.
- `SessionHolderArgs.podCallBus`: the bus the router and the `PodCallResponder` share; the
  responder (`POD_RESPONDER_READY_WAIT_MS`) serves calls another host addresses to this one.

### Drain and fail

- `DRAIN_IN_FLIGHT_CAP_MS`, `LEASE_HAND_BACK_MARGIN_MS`, `DRAIN_HANDOFF_BUDGET_MS`: the budget
  of a drain.
- `SandboxUnavailableError`, `SANDBOX_OFFLINE_GUIDANCE`, `ReadyTimeoutError`, `FencedError`,
  `OpMismatchError`, `ProtocolViolationError`: the failures of a lost, fenced or broken sandbox.
- `isReadOnlyOp(op)`: whether an op reads only, so a retry is safe.

### Review a write

- `qualityStageOf({review, clock, logPort, budgetMs})`: the `QualityStagePort` the tool dispatcher
  calls. It bounds one review, validates the drafts and never replaces a committed write's result.
- `QUALITY_REVIEW_BUDGET_MS`: the 1000 ms budget one review gets.
- `DaemonWorkspaceIdentity`: the `WorkspaceIdentityPort` over the daemon process port. It reads the
  layout, origin and branch with `git` and caches a thread and directory layout (750–1000 ms).

### Test a host

- `FaultProxy`, `ProxyFault`: a proxy that drops, delays, throttles, refuses or holds a link.
- `createMemoryHostPresence({store})`, `createMemoryPodCallHub()`: presence and the `PodCallBus` in
  memory, where every bus sees every request.
- `describeRemoteCalls(target)`, `describeHostPresence(target)`: the two shared suites.

## Usage

```ts
import { SessionHolder, systemTimers } from '@dltech/atlas-host'

const holder = new SessionHolder({
  presence,
  plane,
  bus,
  timers: { now: () => Date.now(), ...systemTimers },
  runtimes,
  ids,
})

await holder.start()
```

## Rules

- Read `@dltech/atlas-host/testing` in a spec only. It opens sockets and injects faults.
- Never import app code, Nest or tRPC here; a boundary spec fails the build on those imports.
- Do not keep the state of a session in a field of your class. Write it to the record, because a
  SIGKILL can end the host at any moment.

## See also

- [docs/decisions/0025-v2-connection-bound-leases.md](../../docs/decisions/0025-v2-connection-bound-leases.md)
  and [0026-v2-hosts-pull-sessions.md](../../docs/decisions/0026-v2-hosts-pull-sessions.md).
- [docs/v2/architecture.md](../../docs/v2/architecture.md) for the held-session loop.
