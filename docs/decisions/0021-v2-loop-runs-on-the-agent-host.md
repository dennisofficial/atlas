# 0021. v2 runs the agent loop on the agent host, not in the sandbox

Proposed 2026-11-02; accepted when the operator merges the PR that adds it. The API no longer stays
on Vercel, and the loop runs beside it in one Render service: see
[0030](0030-api-and-agent-host-are-one-render-service.md). Amends D1 wording of
[0018](0018-v2-pod-first-architecture.md) ("holder pod" becomes "holder": the lease holder is a
agent host, not a pod) and the `pod` package of [0019](0019-v2-package-map.md) (it becomes the agent
host plus the sandbox daemon; the rename is decided in the slice 3 spec).

## Context

0018 put the loop in the pod: the holder pod runs the loop and is the only writer of seqs. That
design was fixed before the wire cost of a remote loop was measured. On 2026-11-02 both
measurements landed:
- One tool-call round trip into a Vercel Sandbox over a single persistent WebSocket costs
  **3.6–6.5 ms p50** (exec p99 49 ms), same-region sandbox-to-sandbox through the `*.vercel.run`
  proxy. The proxy holds an idle WebSocket for at least 180 s. Per-call `runCommand` (one HTTPS
  call per command, no daemon) costs **57–81 ms p50**, so a persistent connection is mandatory,
  not an optimization. Measured 2026-11-02 with `@vercel/sandbox` 3.9.1 against the production
  sandbox image in region `iad1`; the write-up and raw stats live in the slice 3 handoff files,
  not in the repo.
- Production, last 30 days: sequential tool round trips per turn are p50 10 / p90 40 / p99 123,
  and the median turn runs 3.5 minutes. At the measured per-call cost, wire overhead is a few
  hundred milliseconds against minutes of model time — negligible.

Legacy Atlas (the paused cloud stack in `deprecated/`) ran the loop inside the sandbox as a
per-turn engine process over Redis Streams. Running the loop in the control plane is new for
Atlas; there is no in-repo prior art to carry over.

## Decision

**D8. The agent loop (`packages/agent`) runs on a long-lived control-plane service, the agent
host, not in the sandbox.** Sandboxes stay on Vercel Sandbox and only execute. Each sandbox runs a small in-sandbox
daemon — exec, files, grep, background shells, services, stdio MCP, terminal, and private
`operator_input` delivery — reached by the agent host over one persistent WebSocket.

**Agent host: Render, Virginia region, in the operator's company org (the Comp AI workspace).**
The operator confirmed the shape on 2026-11-02: a new `apps/agent-host` service (plain Bun, no Nest
(see [0029](0029-agent-host-is-a-nest-http-app.md), which supersedes that clause)
or tRPC; a Render Background Worker named `atlas-agent-host`), with the API staying on Vercel. The
agent host runs the cloud agent loop and nothing else; it is not a general worker. Background jobs
and schedules run on trigger.dev in `apps/trigger` ([0022](0022-v2-background-jobs-in-apps-trigger.md)),
never as timers in the agent host. Within this record, "agent host" means one replica of that
service. The alternative considered was
moving the whole API to Render and running loops in it; it is rejected because Render's shutdown
grace caps at 300 s, so every API merge would cut every running turn. A separate agent host deploys
rarely and hands off leases within the grace.

**Agent hosts hold the per-session leases of P4.** There are N replicas. The §13 reconciler places
sessions on agent hosts.

**An agent host restart is a clean handoff.** On SIGTERM an agent host takes no new sessions and pauses
every loop it holds. Everything but the model stream open at the drain cap is durable, so the drain does
not wait for the turn to end. A loop between steps pauses at once. A loop waiting on a tool is not
interrupted: the tool runs in the sandbox daemon, which keeps it running and keeps its result under the
step key until a holder confirms receipt, and the leaving host writes nothing about the call. In-flight
work gets until the drain cap (240 s); at the cap only the model stream is aborted, and the partial
output stays in the record marked `aborted: 'handoff'`, so the next holder asks again. Only an in-flight
model stream is lost. "Dispatched, effects unknown" (v1 dispatch recovery) remains for a sandbox that
dies, and for a host-side call that recorded no step. The `agent` loop's existing pause (`PauseSignal`,
checked at every step boundary) is the general handoff pause, and its `RelocationPaused` outcome is
renamed for that purpose in slice 3. The platform's 300 s shutdown grace bounds a drain that never
settles (the handoff budget is 260 s), so a stuck handoff cannot hang the process. Amended 2026-11-27
(#2999): the drain used to detach the daemon calls and abort the turn at once; it now aborts only the
model stream, at the cap, and writes nothing about an open call.

**Input wake and live deltas go through the CP.** The API writes the inbox; the holder is
notified through pub/sub (Redis, which v1 already runs). Render's load balancer assigns a
WebSocket to a random instance, so there is no client-to-agent-host routing: live deltas flow
agent host → pub/sub → API SSE.

**The agent is durable: any turn resumes from the record on any agent host.** The design follows
[Pi Durable](https://earendil.com/posts/pi-durable/) (Earendil, 2026-10-01, experimental); Atlas
borrows the pattern, not the package, because Atlas owns its loop and already has a control plane
over Postgres. The guarantees:

| Guarantee                                  | Where it comes from                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| A turn resumes from the record at any step | The loop's step boundaries and `resume` (slice 2)                                                                               |
| A tool's intent is recorded before it runs | `tool-dispatched` is appended before invocation and dispatch fails closed if it is not (slice 2)                                |
| A tool survives an agent host death        | The daemon keeps running the call and holds its result under its step key until a holder confirms receipt (new, slice 3)        |
| A tool is rerun only if safe               | Read-effect calls rerun; others whose sandbox died are reported as interrupted with output so far (v1 dispatch recovery)        |
| Input is consumed exactly once             | CP inbox ids, consumed through `input-consumed` (slice 1)                                                                       |
| One owner at a time                        | The epoch-fenced lease (slice 1)                                                                                                |
| A hook decides once                        | A hook's decision is recorded in the log and the first write wins, so a hook rerun after a restart reads it back (new, slice 3) |
| Timers survive a restart                   | Retry backoff and delivery windows (the PR delivery buffer) are recorded deadlines, not in-memory timers (new, slice 3)         |
| Aborted model output is kept               | A stream cut by a handoff stays in the record marked aborted, and the next holder asks again (new, slice 3)                     |

Atlas goes further than Pi Durable on tools: a Pi tool runs in the harness process and dies with
it, while an Atlas tool runs in the sandbox and outlives the agent host that started it.

## Why

- The measured numbers make a remote loop affordable: 3.6–6.5 ms p50 per tool call over a
  persistent connection, against a median turn of 3.5 minutes with p50 10 sequential round trips.
- The sandbox stops holding model credentials. The loop, and with it every provider credential,
  lives in the control plane.
- There is one writer, so pod→CP replication of the record disappears. The sandbox disk becomes a
  cache of world state only.
- Sessions no longer die with the pod. A stopped or killed sandbox is a lost cache; the lease
  expires and another sandbox resumes from the record.
- §11 shrinks: with the loop off the sandbox, the priority machinery protects the daemon, not the
  harness.
- The per-call `runCommand` path (57–81 ms p50) is rejected as the transport: 10–15× the WebSocket
  cost with a fat tail (p99 up to 243 ms).

## Consequences

- **Measure first.** Only sandbox-to-sandbox (Vercel → Vercel) RTT is measured. The Render
  Virginia → Vercel `iad1` sandbox RTT is unmeasured; slice 3 measures it before building on it.
- **§11 R2 still applies to the daemon.** The daemon keeps its own cgroup ahead of workloads; a
  saturated sandbox must not starve the daemon that the agent host's tools call.
- **Slice 3 splits in two**: the agent host (lease, runs the agent, appends to the CP, consumes
  the inbox) and the sandbox daemon (the execution surface over one WebSocket).
- The word "pod" survives as the sandbox; "holder pod" in 0018 and the v2 docs now reads as the
  lease holder, which is an agent host.
- The `pod` package of [0019](0019-v2-package-map.md) splits into the agent host and the daemon;
  the rename is fixed in the slice 3 spec.
- Nothing is built by this record. The slice 3 spec is written and approved before building
  starts.

## Amendments (2026-11-04)

Slice 3 changed two statements above.

**Wakes use Postgres `LISTEN`/`NOTIFY`, not Redis pub/sub.** "Input wake and live deltas go through the
CP" said the holder is notified through Redis. The inbox write, a session create and a revoke that still
has work now call `pg_notify` inside their own transaction; agent hosts `LISTEN` on a direct connection
and resync on every reconnect. Redis carries live frames only. Why:
- The operator wanted no polling and an instant wake. Redis pub/sub is fire-and-forget, so it needed a
  poll or a periodic sweep behind it.
- With Redis down there was no wake path at all: the reconcile task also published through Redis. A
  Postgres notification needs nothing else the write does not already need, so a Redis outage no longer
  stops wakes.
- A notification is delivered only if the write commits, so no host wakes for a rolled-back post.

The reconcile task stays as the safety net for a crashed holder, which emits no event, and notifies through
the control plane. This also amends [0022](0022-v2-background-jobs-in-apps-trigger.md)'s "no timers beyond
session loops": the agent host's only timers are lease, daemon and idle-deadline ones, and none looks for
work.

Superseded 2026-11-05 by [0025](0025-v2-connection-bound-leases.md): there is no reconcile task and no
renewal. A lease is live while its holder's Postgres presence lock is held, so a crashed holder is an
event rather than something a sweep looks for.

**The agent host owns its runtime code and imports nothing from v1.** The decision said the host runs the
`agent` loop; in practice it also pulled tools, the model port, prompt fragments and sandbox helpers from
`harness` and `wire`. v1 and v2 now share no logic: v1 has its own copy of the loop
(`packages/agent-v1`), `packages/agent` is v2-only, and the pieces the host used were copied into
`apps/agent-host` and trimmed to what v2 uses. `scripts/check-package-split.ts`, part of `bun run lint`,
fails on an import across the split. Its allowlist of known offenders is empty and may only shrink. v1 is
deleted at cutover, not refactored.

**Partial output on a handoff is kept, not discarded.** The decision says a model stream aborted on a
handoff has its partial output discarded and the new holder asks again. The guarantee table above
already said "kept"; the code keeps it:
- On drain, `HeldSession.beginDrain` pauses the loop (`packages/host/src/holder/held-session.ts:140-143`)
  and `HeldDrain.handoff` (`held-drain.ts:22`) marks the daemon link detached, gives in-flight work until
  the drain cap (240 s), then aborts the **model stream only** (`PauseSignal.abortModelStep`, `:60`). The
  turn is not aborted, so a tool call in the pod keeps running and the leaving host settles it, cancels it
  and writes nothing about it (#2999). Amended 2026-11-27: this paragraph used to say the drain detached
  the running daemon calls and aborted the turn at once, which invented an interruption the pod had not
  proved.
- The model port returns the step accumulated so far, and the loop appends it as `assistant-said` with
  `interrupted: true` and `aborted: 'handoff'` (`packages/agent/src/loop/step-drafts.ts:102-109`,
  `abortedOnHandoff` in `record/append-drafts.ts:35-39`). The next holder resumes from the record and asks
  again. The turn ends as `HandoffPaused`, never `run-failed`.
- The drain's record tail is bounded by `DRAIN_STREAM_ABORT_CAP_MS` (10 s), and the whole handoff by
  `DRAIN_HANDOFF_BUDGET_MS` (260 s: a 240 s cap plus a 20 s hand-back margin), under Render's 300 s
  `maxShutdownDelaySeconds` (`apps/api/src/agent/host/shutdown-sequence.ts:37`). A handoff that
  outlives the budget is ended by the platform, and the epoch fence keeps the record from forking.
