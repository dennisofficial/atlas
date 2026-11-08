# Atlas v2 recovery audit: ways a session can get stuck

Scope: wake → claim → config → sandbox wake → daemon link → turn loop → tool calls → append → drain/handoff → takeover → park.
Method: static read of the code at `/atlas/workspaces/atlas` plus `docs/v2/research/slice-3/live-exit-tests.md`. **Nothing here was reproduced by running it**; each finding says what I read, and "unverified" marks the parts that depend on runtime behaviour (Bun, node-postgres, Vercel). Paths are relative to the repo root.

Out of scope, being fixed by the main agent: `availability` latching in `remote-calls-state.ts` and the uncapped `rewaking-connector.ts`. F-01 and F-03 below interact with that fix, so read them before it lands.

Severity key: **S** = stuck session (no progress and no way out for the user until something external happens), **D** = degraded (recovers, but slowly, invisibly, or only by luck), **C** = cosmetic or hygiene.

## 1. Ranked findings

| #    | Sev          | Trigger                                                                                                                                         | What the user sees                                                                                                                           | Fix, in one line                                                                                               |
| ---- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| F-01 | S            | Any exception out of the turn driver (`RecordCorruptionError`, a DB error inside `resyncHead`, a harness bug); also any idle release that fails | After a failure, every later message sits at "sent" forever; the session is only freed by a deploy or host death                             | Teardown must always settle the lease: revoke on every exit that is not already fenced. Add an own-lease audit |
| F-02 | S            | `failAll` for any reason other than `SandboxUnavailableError` (bad daemon token, malformed frame, op mismatch)                                  | Every tool call fails for the rest of the runtime's life; the user can only wait for the 30-minute idle release                              | Make the link restartable. The `availability` fix alone is not enough                                          |
| F-03 | S            | Daemon link never becomes ready (hung handshake, or connect retries forever)                                                                    | Status `running-tool` or `thinking` forever; **Stop does nothing**                                                                           | Deadline on `ready()`, settle on abort, a visible `sandbox-unreachable` state                                  |
| F-04 | S            | `maxSessions` reached, or a wake lost to any drop                                                                                               | Message stuck at "sent" with no state explaining why                                                                                         | A periodic level-triggered sweep, not edge-triggered wakes                                                     |
| F-05 | S            | LISTEN connection goes half-open or the connect hangs (no `connectionTimeoutMillis`)                                                            | Stop and new messages are ignored by held sessions; unheld sessions are not claimed by this host                                             | Heartbeat the LISTEN connection and re-read inboxes periodically                                               |
| F-06 | D→S          | Runtime factory throws persistently (`SandboxNotConfiguredError`, config read error, `SessionNotFoundError`)                                    | "starting"/"sent" forever; no reason shown; epoch churns every ≤30 s indefinitely                                                            | Classify permanent errors, record a visible failed event, bound retries                                        |
| F-07 | D            | An ack never returns, or `ready()` hangs, inside the serial append queue                                                                        | The whole record freezes: no further events, Stop's `input-consumed` can't land                                                              | Deadline the ack and `ready()` calls, or take them out of the append critical path                             |
| F-08 | S (rare)     | Message posted between `revoke` and `held.delete` in the idle-release path                                                                      | Message is never answered                                                                                                                    | The sweep (F-04) closes it; also make `notifyWake` on an ended session re-queue                                |
| F-09 | D            | `sandbox.wake()` has no overall deadline and ignores the session `signal`                                                                       | "preparing"/`resuming` for minutes (worst case ~6+ min)                                                                                      | One overall deadline, wired to the abort signal, mapped to a visible failure                                   |
| F-10 | D            | A failed turn or failed prepare leaves the keep-alive timer running                                                                             | Cost leak; a dead session keeps its sandbox alive                                                                                            | `stop()` must run on every teardown path                                                                       |
| F-11 | D            | `hold()` rejects "past its guard", or `drive` faults after start                                                                                | Same orphan as F-01                                                                                                                          | Same fix as F-01                                                                                               |
| F-12 | D            | Drain `await this.done` is unbounded                                                                                                            | A hung session stops the host's drain until Render SIGKILLs at 300 s                                                                         | Hard exit timer inside `main.ts`; a bounded `await done`                                                       |
| F-13 | S (no route) | User wants to stop a session                                                                                                                    | There is no API route for stop (the live-test doc says the script posts to the inbox directly; I grepped `apps/api` and found no stop route) | Ship the route before anything depends on Stop as an escape hatch                                              |
| F-14 | C            | Backoffs without jitter, retries without a cap, fire-and-forget promises                                                                        | Retry synchronisation after an outage; whole host can die on one stray rejection (unverified)                                                | Jitter everywhere; a process-level handler that logs and exits deliberately                                    |
| F-15 | D            | Inbox read error swallowed in `InboxIntake.fetch`                                                                                               | A turn can start with no new input while the DB is flaky                                                                                     | Throw, and let the reconciler retry                                                                            |

## 2. Findings in detail

### F-01 (S): the lease is not settled when the held loop ends for a reason other than drain or fence

**Trigger.** Two routes lead to the same state.
- _Turn fault._ `startHeldTurn` calls `args.onFault()` when the turn promise rejects (`packages/host/src/holder/held-runner.ts:63-66`). `HeldSession.startTurn` passes `onFault: () => this.finish()` (`held-session.ts:247`). A rejection comes from `LoopTurnRunner.runTurn`'s catch (`packages/agent/src/loop/run-turn.ts:261-272`), which records an escaped failure and rethrows. Realistic sources:
  - `RecordCorruptionError` from `tryAppend` (`holder/record/record-adapter.ts:256-263`).
  - A DB error thrown by `await resyncHead(...)` after a seq-mismatch (`record-adapter.ts:259`). That call sits **outside** the `try` that turns plane errors into "retry" (`:238-247`), so the F8 path (reply lost, then a DB blip during resync) escapes the retry loop.
  - Any bug in the loop.
- _Failed idle release._ `releaseIdleSession` returns `'failed'` when `sandbox.stop` or `revoke` throws (`held-idle.ts:127-134`). `releaseIdleAndRewake` only returns early for `'superseded'` (`:160`), so a `'failed'` outcome goes on to `args.drop()` and `finish()` (`:165-171`). `released = true` was already set (`held-session.ts:254`). The session is dropped locally and **no revoke has happened**. The `end()` step is `runtime.release()`, which calls `sandbox.stop` (`session-runtime-factory.ts:214-218`); a Vercel API error there is far likelier than a DB blip, and every session passes through this path once after 30 idle minutes (`session-holder.ts:28-31`).

**Current behaviour.** `teardownHeldSession` (`held-idle.ts:83-107`) revokes only when `failedToStart`, or when `draining` and not `lostOwnership`. For a turn fault it reaches line 106 (`runtime.remoteCalls.close()`) and returns. `session-holder.ts:260-264` then deletes the session from `held`. The `V2Lease` row still says `holderHostId = this host`, and that host's presence lock is alive.

**Why it wedges.**
- `claim()` refuses when `holderHostId !== null && holderPresent` (`packages/core/src/record/lease.ts:22-24`). It does not special-case "held by me but not in my held map". A later wake from this host or any other is refused as `held`.
- `sessionsNeedingHolder` only returns sessions whose holder presence lock is absent, or with no holder (`packages/control/src/postgres/postgres-needing-holder.ts:11-16`). A live host is never "absent".
- Nothing audits "leases I hold versus sessions I run".

**What the user sees.** A `run-failed` event gives the status "failed". The next message flips it to "sent" (`sessionStatusOf`, `packages/core/src/record/session-status.ts:~87-155`, the `unconsumedInbox` branch), and it stays there. It is freed only by a deploy or host death (presence loss), at which point the ring wakes it.

**Not covered by an existing test.** The `holder-*.spec.ts` files cover a late read failing (`holder-idle.spec.ts:67`) and startup failure, not a turn throw or a failed `revoke` or `sandbox.stop`.

**Fix.**
1. In `teardownHeldSession`, make the default exit revoke: `revoke({ wantsHolder: <drainWantsHolder-style decision>, epoch })` in a `finally`, for every exit where `!lostOwnership`. `revokeIfEpoch` already makes it safe against a newer holder.
2. Add an own-lease audit to the holder (see §3): every 15–30 s, `SELECT … FROM V2Lease WHERE holderHostId = self`, minus `held ∪ pendingClaims`, revoke with `wantsHolder: true`. This catches the paths nobody thought of.
3. Cap faults per session (see §3 on crash-loops): after N turn faults inside a window, park with a visible `session-stalled` event instead of re-claiming forever.

### F-02 (S): any `failAll` is terminal, not only `SandboxUnavailableError`

`failAll` (`packages/host/src/calls/remote-calls-state.ts:273-283`) calls `this.link.teardown()`, which sets `stopped = true` (`link.ts:69-77`). `DaemonLink.connect` returns immediately when stopped (`link.ts:80`). `readyPromise` is rejected once and never replaced (`remote-calls-state.ts:39-47`, `:276-278`). So after one `failAll`:
- `invoke` awaits the rejected `readyPromise` and throws (`:143-148`) for the life of the runtime.
- That holds for `onUnauthenticated` (close code 4001, e.g. a rotated `DAEMON_SECRET` or stale token), `onFatal` from invalid JSON or an invalid frame (`link.ts:127-142`), and `OpMismatchError` (`remote-calls-frames.ts:138-141`), not just the sandbox-unavailable case.

**Implication for the in-flight fix.** Clearing `availability` is necessary but not sufficient: `link.stopped`, `readyPromise` and the cached rejection also have to be reset, or the next `invoke` still throws. The robust shape is: a failed link tears down and builds a _new_ link plus a new ready promise on the next demand, bounded by a circuit breaker.

**What the user sees.** The model gets tool errors on every call, keeps trying, and the loop guard may cut it. The session does not heal while the user keeps working; it heals after 30 minutes of idleness (idle release builds a fresh runtime) or a host restart. There is no event saying "the daemon link is dead".

### F-03 (S): nothing bounds the time to become ready, and Stop cannot interrupt a call waiting on it

- `DaemonLink.connect` sends the hello and waits (`link.ts:104-106`). Ping only starts in `handleHelloReply` via `schedulePing` (`remote-calls-state.ts:262`). A daemon that accepts the socket and never answers hello has no timeout. The same goes for `webSocketConnector`, which has no connect timeout (`socket.ts:19-47`; unverified how Bun behaves on a black-holed SYN).
- `RemoteCallsState.invoke` registers the call and then `await this.readyPromise` (`remote-calls-state.ts:141-148`). `attachSignal`'s abort handler only aborts the controller and sends `cancel` **if `call.sent && link.ready`** (`:202-209`). A call waiting for ready is neither, so an abort never settles it. Stop (`EHeldAction.AbortTurn`, `held-session.ts:188-190`) aborts the turn signal, but the turn stays stuck inside the dispatch.
- The `tool-dispatched` append itself waits on `remoteCalls.ready()` inside `prepareDraft` (`record-commit.ts:78`), which runs in the serialized append queue (see F-07).
- `handoff()` settles pending calls (`remote-calls-state.ts:86-92`), but `invoke` has not returned its `outcome` yet while it sits at `await readyPromise`, so a drain's handoff does not free it either.
- The reconnect loop in `reconnectLater` (`link.ts:114-125`) never gives up (cap 10 s, jittered, good) and emits no event. The `rewakingConnector` re-wake is the main agent's fix; the missing piece is what the user sees meanwhile.

**What the user sees.** `running-tool` or `thinking`, with no event explaining the delay.

**Fix.**
- A ready deadline (for example 60 s from `open`, extended while a wake is visibly in progress), after which the call settles `interrupted` or `sandbox-unreachable`.
- Abort must settle a not-yet-sent call locally.
- Emit a record event (`sandbox-unreachable{since, attempt, nextRetryAt}`) and show it in `sessionStatusOf` so "waiting for the sandbox" is a first-class, retryable state.

### F-04 (S): wakes are edge-triggered and dropped at capacity or while a claim is pending

`SessionHolder.onWake` (`session-holder.ts:139-153`) returns silently when:
- the session is in `pendingClaims` or `startBackoff` (`:146`), or
- `held.size + pendingClaims.size >= maxSessions` (`:147`, default 25, `apps/agent-host/src/config/env.ts:25`).

The dropped wake is not remembered. The only things that re-scan `sessionsNeedingHolder` are listener (re)connect (`onResync`, `:159-176`), presence registration, and a host dying (`pg-host-watch.ts:124-135`, `scanOrphans` only if `deathsScanned < deathsSeen`). When a held session idles out, `releaseIdleSession` revokes with `wantsHolder: false` (`held-idle.ts:121-125`), which does not notify, so a freed slot does not pull a waiting session. Held sessions count against capacity for the whole 30-minute idle window.

**Evidence there is no periodic backstop.**
- `apps/trigger` is empty. The design's `reconcile-holders` task (`docs/v2/slices/03-agent-host.md:279`) was deleted by the connection-bound-lease plan (`docs/v2/architecture.md:515`).
- A grep for `setInterval` in the non-test sources of `apps/agent-host/src` and `packages/host/src` finds none.

**What the user sees.** "sent". A repeat message re-fires NOTIFY and works once a slot is free, but nothing tells the user that.

**Fix.** A level-triggered sweep (§3).

### F-05 (S): the wake channel has no liveness check

`startPgListener` creates `new pg.Client({ connectionString, keepAlive: true, application_name })` with **no `connectionTimeoutMillis`** and no query timeout (`apps/agent-host/src/bus/pg-listener.ts:64-77`). The presence and watch clients do set a 5 s connect timeout (`pg-host-presence.ts:31-44`); the listener does not.
- If `next.connect()` or the `LISTEN` query hangs, neither `error` nor `end` fires, `client` is set, and no retry is scheduled (`:71-78`). The listener is permanently deaf and never resyncs.
- If an established connection goes half-open, nothing probes it. `keepAlive: true` without `keepAliveInitialDelayMillis` leaves the idle time to the OS default (Linux: 2 h), unverified for this runtime. `packages/db/src/pool.ts:103` sets 1 s for the pool only.
- Both wake and presence/lease connections are listed as "kernel keepalive on" in `docs/v2/architecture.md:467`; I found no code that sets the delay for the listener or presence clients.

**Consequence for held sessions.** Stop and new input to a held, idle session arrive as NOTIFY only. The `Wait` action just arms the idle timer (`held-session.ts:224-227`); no periodic inbox read exists. A deaf listener therefore wedges held sessions, not just new ones. `pg-change-feed.ts` (stream side) uses the same listener.

**Fix.** Connect and query timeouts, a self-ping (`pg_notify` to a per-host channel with a deadline) that tears down and reconnects on silence, and a periodic inbox re-read for held sessions (§3).

### F-06 (D→S): permanent start failures retry forever with no visible state

`HeldSession.drive` sets `failedToStart` when the runtime factory or record open throws and no reconciler exists yet (`held-session.ts:161-165`). `teardownHeldSession` then revokes with `wantsHolder: true` (`held-idle.ts:95-99`), and `StartBackoff.failed` retries after 1 s doubling to 30 s with no jitter and no maximum count (`start-backoff.ts:14-27`).
- `SandboxNotConfiguredError` (`session-runtime-factory.ts:30-35`, thrown at `:63-65`) is permanent until the user connects Vercel. It loops every ≤30 s: claim, bump epoch, revoke, notify. No event is appended.
- The workspace-prepare path does record a visible `workspace-prepare-failed` (`held-prepare.ts:61-81`) but only after the runtime opened. Start failures before that have no equivalent.

**What the user sees.** "sent" or "starting", indefinitely, with the reason only in host logs.

**Fix.** Classify errors (permanent / transient). For permanent ones, append a visible failed event with the reason and a retry affordance, and stop retrying until a new message. For transient ones, jitter and cap, then convert to the same visible state.

### F-07 (D): daemon-dependent awaits sit inside the serial append queue

`SessionRecord.append` chains everything on one `tail` promise (`record-adapter.ts:109-122`). Inside it:
- `prepareDraft` awaits `remoteCalls.ready()` for daemon tools (`record-commit.ts:77-78`), with no deadline.
- After a `tool-result` commits, `ackDaemonScope` awaits `ackScope` → `ackKey`, which resolves only on an `acked` frame or a failure (`remote-calls-state.ts:179-200`). With the link down, it waits. It catches errors but has no timer (`record-commit.ts:9-30`, `record-adapter.ts:206-214`).

One stuck await therefore blocks **every later append**, including Stop's `input-consumed` (`held-wait.ts:17-24`) and the branch observer. Local mitigation exists (the daemon prunes unacked scopes at boot, per the log message in `record-commit.ts:25`), which shows the ack was meant to be best-effort; it just is not bounded.

**Fix.** Deadline the ack (a few seconds), then log and move on, or fire it after the append returns instead of awaiting it. Give `ready()` inside `prepareDraft` a deadline that maps to F-03's visible state.

### F-08 (S, narrow window): a message in the idle-release gap is swallowed

In `releaseIdleAndRewake` (`held-idle.ts:149-173`): revoke commits with `wantsHolder: false`, then `lateInputMaybePending` reads the inbox, and `deps.onDrop?.()` runs only `if (maybePending)` (`:165-167`). On the no-pending path the session stays in `held` until `teardown` finishes. A post in that window fires NOTIFY; `onWake` finds the session in `held` and calls `notifyWake`, which returns because `lostOwnership` is set (`held-session.ts:77-80`), and the reconciler is stopped (`:278-284`). The entry is unconsumed, the lease is free, and nothing re-scans. The existing "input posted during the release" test (`holder-idle.spec.ts:29`) covers posts before the late read, not after it.

**Fix.** The sweep (§3). Cheaper local fix: when `notifyWake` hits an ended session, re-queue a wake after it leaves `held`.

### F-09 (D): sandbox wake has no overall deadline and ignores the abort signal

`VercelSandboxProvider.wake` accepts `signal` but never uses it (`vercel-sandbox-provider.ts:34-68`). `mountWithRetries` can loop up to `settleRetry` = 30 × 5 s for a missing sandbox, plus `imageOptimizeRetry` = 12 × 30 s (`sandbox/constants.ts:17-19`), each `getOrCreate` capped at 60 s (`vercel-mount.ts:60`); `launchDaemon` then waits up to 30 s to listen (`daemon-launch.ts:18`). Worst case is several minutes with no event; bounded, but not by one budget and not cancellable when the session lifetime ends. Prepare has its own 15-minute deadline (`session-runtime-factory.ts:39`, `:122-138`), which does turn a timeout into a visible `setup-failed`. But note that clone and setup each have 10-minute timeouts (`workspace-clone.ts:19`, `workspace-setup.ts:25`), above the 15-minute total; the abandoned attempt keeps running while the retry attaches to the same call keys (`scopeKeyOf` makes the keys identical, so the daemon dedupes; that part looks idempotent).

**Fix.** One `AbortSignal.any([signal, timeout])` through the whole wake; map expiry to a visible state.

### F-10 / F-11 (D): teardown paths that skip `runtime.stop()`

`teardownHeldSession` only calls `runtime.stop()` when draining (`held-idle.ts:101-105`). For a turn fault or a failed start-after-runtime path, the keep-alive timer created in `session-runtime-factory.ts:176-194` is cleared only on `signal` abort, `stop` or `release`. `lifetimeAbort` is never aborted on those paths, so the timer renews the sandbox forever for a session nobody runs. `SessionHolder.hold`'s `done.then(…, reject)` branch (`session-holder.ts:266-273`) only deletes the map entry, with no revoke and no teardown. Fix together with F-01: one teardown that always stops the runtime and settles the lease.

### F-12 (D): drain has no hard bound

`HeldSession.handoff` ends with `await this.done` (`held-session.ts:113`). If a session is hung (F-03/F-07), `done` never settles and `holder.drain` never returns. `main.ts` has no outer timer (`main.ts:117-132`); Render's `maxShutdownDelaySeconds: 300` (`docs/v2/slices/03-agent-host.md:669`) is the only bound, and the process is SIGKILLed with no revokes. This is crash-only and the ring recovers it (F11, F19 show that path works), so it is D, not S. The live test for F12 passed only because the bash finished inside the window.

### F-13 (S for the user): no stop route

`docs/v2/research/slice-3/live-exit-tests.md` (Test 9) says "there is no API route for stop yet". My grep of `apps/api/src`, `packages/api-router` and `packages/client` found no stop handler (only sandbox stop calls). Until a route exists, the user's only recovery from a wedged turn is another message.

### F-14 (C): hygiene

- Jitter exists on the link backoff (`link.ts:119`) and append retry (`record-adapter.ts:287`). It is missing in `reconcileBackoffMs` (`reconciler.ts:3-4`), `StartBackoff` (`start-backoff.ts:20`), `HolderPresence.scheduleRetry` (`holder-presence.ts:75`), `scheduleResyncRetry` (`session-holder.ts:180`), `pg-listener.ts:48`, `pg-host-watch.ts:91`.
- Retries with no cap and no breaker: the reconciler (`reconciler.ts:46-70`), start backoff, presence re-register, link reconnect. All are visible only in logs.
- `main.ts` has no `unhandledRejection` or `uncaughtException` handler (grep found none), and `void`-ed promises are common. Whether Bun exits on one is unverified; if it does, one stray rejection takes all of a host's sessions down together, followed by a claim storm.

### F-15 (D): swallowed inbox read

`InboxIntake.fetch` does `readStrict(...).catch(() => [])` (`inbox-intake.ts:71`). A DB blip makes `prepare()` return no drafts while `readHeldAction` still sees the entry as pending; the turn can start with nothing to answer. Probably bounded by the next reconcile, but I did not trace it to the end.

### What I checked and found sound

- Appends: bounded 30 s retry with jitter, then self-fence and abandon presence (`record-adapter.ts:183-221`, `:273-284`; F6/F7/F24).
- Model stream: TTFB 30 s, first chunk 180 s, chunk 120 s (`ai-sdk-model-port.ts:38-42`), 5 attempts per step in the loop (`retrying-step.ts`).
- Presence loss: re-register with backoff (`holder-presence.ts:55-81`), every held session fenced (`session-holder.ts:128-137`; F22).
- Tool-level timeouts on bash (default 120 s, max 600 s) and daemon exec; `settleCrashedCalls` settles crashed non-read calls (`dispatch-recovery.ts`).
- Daemon side: epoch fencing and key-deduped runs (`packages/protocol/src/engine`).
- Failed prepare is a visible state with a retry on the next message (`held-prepare.ts`).

## 3. Structural gaps

**v2 has no session reconciler or progress watchdog.** The design had one (`reconcile-holders`, a minute-cadence trigger task); the connection-bound-lease work deleted it, on the premise that Postgres presence replaces timers for _liveness_. That premise holds for host death. It does not hold for the failures above, where the host is alive and a session is not progressing. Every recovery in v2 today is **edge-triggered**: a NOTIFY, a listener reconnect, a host death, a deploy. A missed edge is never retried. There is also no per-session "is it making progress" check: the only timers are append retry, prepare deadline, idle deadline and model stream timeouts, none of which watch a session that is simply waiting on something.

The invariant to build toward: **every session is, at all times, in exactly one of: _progressing_ (an event, tool output or live frame within T, or a call inside its own deadline), _idle_ (no unconsumed inbox, no resumable turn), or _failed-visible_ (a recorded event with a reason and a retry affordance).** Anything else is a bug, and the system should detect and repair it itself.

Proposed pieces (all small, none exotic):
1. **Level-triggered sweep in each host**, every 15–30 s with jitter: `sessionsNeedingHolder` → `onWake` (the query already exists and is indexed per the slice doc). This alone closes F-04, F-05 (partly), F-08, and any future lost wake. The cost is one cheap query per host per interval.
2. **Own-lease audit** in the same tick: leases with `holderHostId = self` that are not in `held ∪ pendingClaims` get revoked with `wantsHolder: true`. Closes F-01, F-10, F-11 regardless of which path orphaned them.
3. **Per-session progress watchdog** in `HeldSession`: if status would read `thinking` or `running-tool` and nothing has been appended or streamed within a bound longer than the longest legitimate call (bash max is 600 s), abort the turn, append a `session-stalled{reason}` event, and let the existing resume logic retry. Closes F-03 and F-07's tail.
4. **A visible stalled/failed state in `sessionStatusOf`** for failures that today leave no event (start failures, sandbox unreachable, link dead). Events are the only thing clients see, so the host must write one.
5. **Held sessions re-read the inbox periodically** (every 30 s), independent of NOTIFY, so Stop works even with a deaf listener.
6. **Restartable daemon link with a circuit breaker**: failed link → new link on demand, exponential backoff with jitter, a cap, then a visible failed state (F-02, F-03).
7. **Crash-loop quarantine**: a counter on the lease row (or a recorded event count) so a session that crashes its holder N times in a window parks with a visible reason instead of walking the host ring. Today a poison session (for example one whose record load exhausts memory; 20k events took 2.7 s to load in the live test) would crash every host that claims it, one after another. This is a gap in the design, not something I observed.
8. **Hard bounds at the edges**: connect and query timeouts on listener, presence, and watch clients; drain hard-exit timer; deadline on `wake()`.
9. **A stuck-session invariant checker** in the fault rig (and as a production metric): after any fault row, within bound B a session must show an appended event or a failed-visible state. This turns "everything is resumable" from a belief into an assertion that runs against every row.

Bounded retries with backoff and jitter exist piecemeal; circuit breakers and idempotency keys are only present at the daemon call layer (call keys, once-ledger). The record append path is idempotent by hash chain (F8). Holder startup is idempotent by epoch CAS.

## 4. Coverage by fault rows

Existing rows F1–F21 are from `docs/v2/slices/03-agent-host.md:754-774`. F22–F27 and `exit7` exist as spec files in `apps/agent-host/src/__tests__/faults/`; I read only their test titles, not their definitions. No `f16` file exists (F16 may be covered by `exit7-zombie-writer` or `f25-partition`; I did not confirm).

| Finding   | Closest existing row(s)                                                                                                               | Gap                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| F-01      | none (F10/F11/F13–F15 kill the whole host; F8 resets the reply but not a DB error in resync)                                          | New rows F28, F29, F38              |
| F-02      | F3/F5 (link drops that heal)                                                                                                          | New row F31b                        |
| F-03      | F4 (black-hole mid-bash, link already ready); F18 (stopped sandbox, passes after #1892); F20 (stop during outage, link was up before) | New rows F31, F33                   |
| F-04      | F23/F27 (ring walk), F26                                                                                                              | New row F34                         |
| F-05      | F9 (Redis down), F25 (partition on the lock connection)                                                                               | New row F35                         |
| F-06      | none                                                                                                                                  | New row F30                         |
| F-07      | F2 (throttled output), F3                                                                                                             | New row F32                         |
| F-08      | none (`holder-idle.spec.ts:29` is a unit test of a different window)                                                                  | New row F36                         |
| F-09      | F21 (holder killed while waking)                                                                                                      | New row F39                         |
| F-10/F-11 | none                                                                                                                                  | Part of F28, F29                    |
| F-12      | F12 (passes because the bash ends in time)                                                                                            | New row F41                         |
| F-13      | F20 depends on an API/inbox Stop                                                                                                      | A route plus an end-to-end Stop row |
| F-14      | F6, F7 cover the append path only                                                                                                     | Part of F35                         |
| F-15      | F6                                                                                                                                    | New row F42                         |

Proposed new rows. Each states the injected fault and the expected result, in the same style as the table in the slice spec.

| Row  | Fault                                                                                                                    | Expected                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| F28  | Inject a throw out of the turn driver (for example `RecordCorruptionError` from a fake plane) while the host stays alive | Lease released or re-claimed within 10 s; next message answered; keep-alive timer cleared; sandbox not kept alive for a dead session |
| F29  | `sandbox.stop` throws, then separately `revoke` throws, during idle release                                              | Next post is claimed and answered; no wedged lease; a retry of the release                                                           |
| F30  | Runtime factory throws permanently (`SandboxNotConfiguredError`, config read error)                                      | A visible failed event with the reason within 30 s; no epoch churn; a new message after the fix works                                |
| F31  | Daemon accepts the socket and never sends hello-reply                                                                    | `ready` deadline fires; the call settles with a visible reason; Stop settles in ≤2 s                                                 |
| F31b | Send a malformed frame, an op mismatch, or a stale token (close 4001)                                                    | The link restarts on the next call (or the session shows a visible failed state with retry), not a dead runtime                      |
| F32  | Daemon never answers `ack` after a `tool-result`                                                                         | Next append commits within a few seconds; Stop's `input-consumed` lands                                                              |
| F33  | Press Stop while the link is not yet ready (sandbox waking)                                                              | The turn stops ≤2 s; no hang                                                                                                         |
| F34  | `maxSessions=1`, two sessions with input; the first idles out                                                            | The second is claimed with no new post                                                                                               |
| F35  | Half-open the LISTEN connection (drop packets without RST), then post a message and a Stop to a held session             | Detected and reconnected, or the sweep delivers it, within a stated bound (for example ≤30 s)                                        |
| F36  | Post a message in the window after `revoke(wantsHolder:false)` and before the held entry is removed                      | Answered                                                                                                                             |
| F37  | A session that crashes its holder on every claim (a poison record)                                                       | Parked with a visible reason after N crashes; other sessions unaffected                                                              |
| F38  | Seq-mismatch (reply lost), then a DB error during `resyncHead`                                                           | Retried inside the append budget; no turn fault                                                                                      |
| F39  | `sandbox.wake()` stalls (Vercel API hang) past the deadline                                                              | A visible "sandbox unavailable, retrying" state, then recovery when the API returns                                                  |
| F41  | SIGTERM while a call is stuck (daemon hung)                                                                              | Host exits within the shutdown budget without waiting for SIGKILL; session handed off                                                |
| F42  | DB read error during inbox read at turn start                                                                            | No turn starts without input; retried                                                                                                |

Every new row should also assert the §3 invariant: within a stated bound, the record shows an appended event or the status is a failed-visible state, and a follow-up message is answered.

## 5. Not verified

- Everything above is from reading source; nothing was executed. F-01's chain (turn throw → teardown without revoke → `claim` refuses a self-held lease) is the most important thing to confirm with a spec: inject a throwing runner into the `holder-*.spec.ts` rig and post a second message.
- node-postgres keepalive defaults for F-05 and Bun's WebSocket behaviour on a black-holed connect (F-03) are from general knowledge of the libraries.
- Bun's default on unhandled rejections (F-14).
- F22–F27 definitions were not read beyond test titles.

## Main-agent verification (2026-11-05)

- F-01 confirmed by reading: `held-session.ts:247` `onFault: () => this.finish()`; `teardownHeldSession` (`held-idle.ts:95-107`) revokes only on `failedToStart` or `draining`, otherwise just closes the daemon link, so the lease row stays on a live host.
- F-02/F-03 (permanent link failure): addressed for every non-fenced failure in #1899 (`ReadyGate` + `DaemonLink.restart`); the ready deadline and the Stop-while-waiting-on-ready part are still open.
- F-04 confirmed: `session-holder.ts:145-147` returns on pending claim, start backoff or `maxSessions` with no later retry.
- F-06 confirmed: `start-backoff.ts` retries 1 s doubling to a 30 s cap, forever, with nothing appended.

## Closed 2026-11-08 (audit steps 4–5)

| Edge / gap | Bound and outcome | PR |
| --- | --- | --- |
| Daemon `ready()` wait in `invoke` and `ackKey` | 60 s; `invoke` rejects `ReadyTimeoutError` and drops the call, `ack` resolves false; an abort before send settles the call interrupted | #2016 |
| `sandbox.wake()` | 5 min combined with the caller's signal; `SandboxUnavailableError`, which the prepare path already shows | #2016 |
| Drain | hard exit at `drainMs + 20 s` (inside Render's 300 s), logged and exit 1 | #2016 |
| LISTEN connect and query | 5 s connect, 10 s `LISTEN`, then the existing drop-and-retry | #2016 |
| A turn that stops progressing | 11 min with no activity aborts the turn and records `run-failed{kind:'stalled'}`; the session stays held and failed-visible, and the next message resumes it | #2019 |

The watchdog reuses `ERunFailureKind.Stalled`, so no record-union change was needed and the existing
remedies table already offers Retry.

Still open from this audit: a Stop API route (F-13), crash-loop quarantine (§3 item 7), the fault-rig
invariant (§3 item 9), jitter and process-level handlers (F-14), and a deadline on the public
`RemoteCalls.ready()` (only the waits inside `invoke` and `ackKey` are bounded).
