# Slice 5: `SessionHolder` in `packages/host/src/holder`

Branch `dennis/v2-session-holder`, cut from `origin/main` **after slice 2 (host remote calls) merges**.
One PR titled `feat(host): session holder: claim, renew, self-fence, record cache, drain (slice 3, PR 3)`.

## Start after

#1778 (remote calls) merged as b864b8372, **and** the rename PR #1787
has merged. Use the new names everywhere below: `WAKE_CHANNEL`, `wakeMessageSchema`, `sessionLiveChannel`,
`inboxMessageSchema`, `INBOX_KIND_MESSAGE`, `ESessionStatus`, `DAEMON_SECRET`; inbox requestId prefix `inbox:<n>`
(not `v2-inbox:`); live frame schema `liveFrameSchema` (not `v2LiveFrameSchema`). Merged host API, from
`packages/host/src/index.ts`: `RemoteCalls` (`open`, `ready`, `bootId`, `invoke`, `ack`, `ackScope`, `close`),
`RemoteCallsArgs { sessionId, token, connector, timers, onFenced, log? }`, `ScopedToolDispatcher`,
`runInCallScope`, `markDispatched`, `scopeDispatchedBootId`, `dispatchableScopeKey`, `scopeKeyOf`, `nextKey`,
`FencedError`, `SandboxUnavailableError`, `DaemonProcessPort`, `DaemonFileSystemPort`, `DaemonAgentFileSystemPort`,
`webSocketConnector`. `LogPort` comes from `@dltech/atlas-observability`.

## Goal

The spec's last deep module (`docs/v2/slices/03-agent-host.md` points 3–8 and 14, plus "The agent
host's other deep module"): `SessionHolder { start(): Promise<void>; drain(args: { deadline: number }): Promise<void> }`.
It hides claiming on a wake, renewal, self-fencing, the per-thread record cache with per-event appends,
the inbox intake, the durable OnceLedger, running the `agent` loop, acks after commit, live output and
the clean handoff. Time, the bus, the control plane and the per-session runtime (model + tools +
remote calls) are injected, so every lease case runs on a fake clock in milliseconds. `apps/agent-host`
(slice 6) is its only production caller. Read [../decisions.md](../decisions.md) in full first.

## What exists (read first)

- Control (merged, #1766): `packages/control/src/control-plane.ts`, `lease-ops.ts`. **`grant` always takes the
  lease, even from a live holder** (`packages/core/src/record/lease.ts:17`). `renew` refuses `stale-epoch` /
  `lease-expired`. `revoke({ sessionId, wantsHolder })`. `append({ threadId, epoch, events })` returns
  `AppendOutcome` (`refusal.kind`: `stale-epoch`, `lease-expired`, `seq-mismatch`, `malformed`, …; see
  `packages/control/src/refusal.ts`). `readEvents({ threadId, afterSeq, limit ≤1000, visible })` → `{ events, next? }`.
  `readInbox({ sessionId, afterId, limit })` returns unconsumed entries only. `readSession`. `head`.
  In-memory store for tests: `@dltech/atlas-control/testing` `InMemoryControlStore({ clock })`.
- Core record: `chainEvents` (`packages/core/src/record/chain-events.ts`) stamps seq/prevHash/epoch from a
  `LogHead`. `chainHash`. `visibleEvents` (`visibility.ts:92`). `V2Event` = loop `EventBody` (minus
  `history-compacted`) ∪ `RecordBody` (`history-rewound`, `history-summarised`, `input-consumed`,
  `fact-recorded`) (`record/event.ts`). The agent loop works on `Event` (`packages/core/src/events/envelope.ts`):
  v2 events carry extra `epoch`/`prevHash`; record-only bodies are not loop events.
- Agent loop: `LoopTurnRunner(TurnDeps)` (`packages/agent/src/loop/run-turn.ts:50-87`, `say`, `resume`,
  `runTurn`), `AgentRecordPort`/`ModelContextPort` (`packages/agent/src/record/agent-record.port.ts`),
  `AgentIntake` (`intake/agent-intake.ts`, `PendingDrain` in `loop/pending-intake.ts:6`), `OnceLedger`
  (`loop/once-ledger.port.ts`; in-memory reference `testing/in-memory-once-ledger.ts`), `PauseSignal`
  (`loop/pause-signal.ts`), `settleCrashedCalls` (`loop/dispatch-recovery.ts:29`), `AgentOutput`
  (`loop/agent-output.ts`). The dispatch marker draft comes from `onDispatchStarted`
  (`loop/settle-pending.ts:65`, `tools/dispatch-drafts.ts:12`) **inside** the tool's dispatch, i.e. inside the
  `ScopedToolDispatcher` scope. Test rig to copy: `packages/agent/src/__tests__/exit-fixture.ts`
  (`ScriptedModel`, `SequentialIds`, `fakeToolRegistry`, `HookedToolDispatcher`).
- Remote calls (slice 2, `packages/host/src/calls`): `RemoteCalls` (`open`, `ready`, `bootId`, `invoke`, `ack`,
  `ackScope`, `close`, `onFenced`), `ScopedToolDispatcher`, `scopeKeyOf`, `markDispatched`, the daemon-backed
  ports, `SandboxUnavailableError`, `FencedError`. **Read its merged code and report**; adapt to the real names.
- Bus names: `@dltech/atlas-protocol` `WAKE_CHANNEL`, `wakeMessageSchema`, `sessionLiveChannel`. Inbox message
  payload: `inboxMessageSchema` with kind `INBOX_KIND_MESSAGE` (both merged).
- Idle rule: `serveIdleDue` (`packages/core/src/execution/lifecycle.ts:18`).

## Build

1. **Control: `claim`.** Add `ControlPlane.claim({ sessionId, holderId, ttlMs }): Promise<ClaimResult>` where
   `ClaimResult = { ok: true; lease } | { ok: false; refusal: { kind: 'held'; epoch } }`, refusing when the lease
   is live at DB time. It is a pure rule in core (`claim` beside `grant` in `lease.ts`) driven through
   `LeaseOps.mutateLease`. Add conformance cases (both stores): a claim on a live lease is refused, an expired
   or revoked one is taken (epoch+1), and 8 concurrent claims give exactly one winner. Keep `grant`.
2. **Ports** (`holder/ports.ts`): `HostBus = { onWake(listener: (sessionId) => void): () => void; wake(sessionId): Promise<void>; live(args: { sessionId; frame: V2LiveFrame }): void }`
   with a `liveFrameSchema` in protocol `bus.ts` (`tool-output` {callId, text} | `retrying` | `status`
   {state}). `HostTimers` (`now(): number`, `setTimeout`, `clearTimeout`, `random()`). `SessionRuntimeFactory =
   (args: { sessionId; epoch; signal }) => Promise<SessionRuntime>` with `SessionRuntime = { remoteCalls:
   RemoteCalls; model: ModelPort; tools: ToolRegistry; daemonTools: ReadonlySet<string>; effectOf:
   ToolEffectResolver; assembly; normalizeFailure; launchDirectory; stop(): Promise<void>; release(): Promise<void> }`.
   `stop` ends the runtime for a handoff and leaves the sandbox running. `release` ends it for idle and
   stops the sandbox. Slice 6 implements this factory. Tests use a fake one over `createInMemoryDaemon`.
3. **Record cache + adapter** (`holder/record/`): per thread, load every visible event in pages of 1000 on claim.
   It implements `AgentRecordPort` and `ModelContextPort`. `ownEvents`/`composedEvents` return the cached log
   as loop `Event`s (strip `epoch`/`prevHash`, drop `RecordBody` types). `ModelContextPort.read` returns the
   same over `visibleEvents`. `append` stamps with `chainEvents` from the cached head at the held epoch,
   appends **one event per draft, each in its own `plane.append` call** (spec point 4), and extends the
   cache on success. Rules:
   - A draft `user-said` with `requestId` `inbox:<n>` gets `input-consumed { inboxId: n }` prepended to the
     same append (decision).
   - A `tool-dispatched` for a call that already has one in the cache is dropped. Call `markDispatched` with the
     recorded `bootId`. For a call in `daemonTools`, first await `remoteCalls.ready()`, stamp
     `bootId: remoteCalls.bootId()` on the draft, and call `markDispatched` with it.
   - After a `tool-result` commits for a daemon tool, call `remoteCalls.ackScope({ scopeKey })`. An ack failure
     is logged, never thrown, because the daemon prunes at boot.
   - A refusal `stale-epoch`/`lease-expired` → throw `LeaseLostError` and tell the holder to drop the session
     at once. `seq-mismatch` with the same hash at that seq already committed (re-read `head`/the event) is the
     append-reply-lost case (F8): treat it as success. Any other `seq-mismatch` or `malformed` is a bug: throw
     loudly. A network or thrown error is retried with backoff (100 ms doubling, jittered) until the holder's
     fence deadline, then `LeaseLostError`.
   - **Aborted on handoff**: when the holder is draining past its deadline, an `assistant-said` draft with
     `interrupted: true` is written with `aborted: 'handoff'` instead. Check whether core assembly drops
     `aborted` output (spec point 8). If it does not, add that to core assembly with a pure test and report it.
4. **Intake** (`holder/inbox-intake.ts`): `AgentIntake.prepare` reads unconsumed inbox entries in order. `message`
   → `user-said` draft (`requestId: 'inbox:<id>'`, text from the payload schema), `wakesTurn: true`. An
   unknown kind is consumed with no draft, logged. `stop` is handled by the holder (next point), not drafted.
5. **OnceLedger** (`holder/record/v2-once-ledger.ts`): `once({ key, decide })` returns the cached
   `fact-recorded` value for `key`. Otherwise it runs `decide` and appends `fact-recorded { key, kind:
   key.split(':')[0], value }`. Concurrent callers share one decide. Append through the record adapter
   (runId: a fresh run id).
6. **Holder** (`holder/session-holder.ts` + internals, each ≤300 lines). Args: `{ holderId, plane, bus, timers,
   runtimes: SessionRuntimeFactory, ids, maxSessions, ttlMs = 30_000, renewEveryMs = 5_000, fenceMarginMs =
   5_000, inboxPollMs = 2_000, idleMinutes = 30, log }`.
   - `start()`: subscribes to wakes. For each wake below `maxSessions`, not already held: `claim`. On refusal, drop it.
   - On claim: create the session's `AbortController`, load the main thread cache, build the runtime (it may
     still be booting; `remoteCalls.ready` holds tools, never the model), and build `LoopTurnRunner` with the
     adapter, intake, OnceLedger, the runtime's model/assembly and `ScopedToolDispatcher(HookedToolDispatcher)`,
     plus `output` publishing to `bus.live`. Run `settleCrashedCalls` with an `effectOf` that maps
     `daemonTools` → `EToolEffect.Read` (decision). If the record shows an unfinished turn (`isResumable` in core
     `events/resume-plan.ts`), `resume`. Then loop: drain inbox → `runTurn` while input is pending. Probe
     `ackScope` for each daemon call in the tail since the last `user-said` whose result is recorded (row 1).
   - Renew every `renewEveryMs`. A refusal → drop. Failures are retried. If no renew has succeeded within
     `ttlMs - fenceMarginMs` by its own clock, it **self-fences**: aborts the session, closes remote calls,
     drops it without revoking (it may not own it).
   - While a turn runs, poll the inbox every `inboxPollMs`. A `stop` entry aborts the turn (abort → the
     daemon-backed ports send `cancel`) and is consumed with `input-consumed`.
   - Idle: once `serveIdleDue` holds (no turn running, no pending input; shells/services are counted as 0 in
     slice 3), `runtime.release()`, then `revoke({ wantsHolder: false })`.
   - `drain({ deadline })`: stop claiming. `PauseSignal.pause()` every held session (a loop between steps stops).
     A loop waiting on a tool is left. A model step may finish until `deadline`; past it, abort with a handoff
     reason so the adapter stamps `aborted: 'handoff'`. Then for each session `runtime.stop()`,
     `revoke({ wantsHolder: true })` and `bus.wake(sessionId)`. Resolves when all are released.
   - Status frames on the live channel for `starting` (runtime building / `ready` pending) → `thinking` → `idle`.
7. Exports from `packages/host` `index.ts`: `SessionHolder`, the ports and their types. Internals stay internal.

## Tests (through `SessionHolder` only; in-memory plane, fake timers, scripted model, in-memory daemon, in-memory bus)

One file per topic, each ≤300 lines, shared rig in `__tests__/holder-rig.ts`:
- **Claim:** two holders get the same wake; exactly one runs the turn. A live lease is never stolen. A lost
  wake (none published) is picked up by a later wake.
- **Turn:** post → claim → `input-consumed` + `user-said` in one append; a tool via the fake daemon;
  `tool-dispatched` carries the daemon bootId; `tool-result`; the daemon key is acked (fake `runCount`,
  then a `run` replay answers unknown→ the key is gone). Every event appended individually; the chain verifies.
- **Handoff (F12/F15):** holder A runs a long exec. `drain` → A revokes (`wantsHolder: true`) and wakes. Holder B
  claims, resumes, the exec is collected without a second spawn (`runCount` 1), and exactly one
  `tool-result` exists.
- **Crash (F11/F13/F14):** A is discarded without drain (stop its timers; lease left to expire); advance past
  the TTL; B claims via a wake; the call is collected or run once, never twice. Variant: `tool-dispatched` committed but
  the daemon never got `run` → B runs it once. Variant: the daemon restarted (new bootId) → a `bash` call
  becomes interrupted, a `read` reruns.
- **Self-fence (F7):** make `plane.renew` throw for `ttl - margin`; A aborts and stops writing; no append at the
  old epoch lands after B claims.
- **Zombie (F16):** A keeps running after B claims; A's next append is refused and A drops the session.
- **Append reply lost (F8):** a store wrapper that commits then throws; the turn completes with no fork.
- **OnceLedger:** a retry deadline recorded by A is read back by B (B waits until `notBefore`; fake clock).
- **Stop:** a `stop` inbox entry mid-exec aborts and cancels; the result says cancelled.
- **Idle:** after 30 idle minutes (fake), `release` and `revoke({wantsHolder:false})`; a new post wakes and reclaims.
- Mutation checks you run yourself: remove the dispatched-duplicate drop; remove the `ackScope` after commit;
  make `claim` take live leases. Each must fail a test. Restore with `git checkout --` and check `git status`.

## Rules

CLAUDE.md style. `packages/host` still imports no harness, Nest, tRPC or `apps/*` (boundary spec). You own
`packages/host/src/holder`, `packages/host/src/index.ts`, the `claim` addition in control and core `lease.ts`,
protocol `bus.ts` (live frame), and core assembly only if aborted output is not already dropped. Run
`cd packages/host && bun test`, `cd packages/control && bun test`, `cd packages/core && bun test src/record`,
and root `bun run typecheck`. Push, `gh pr create`, then **stop and report**. Do not poll CI or merge; never force-push.
