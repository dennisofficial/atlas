# 0021. v2 runs the agent loop on control-plane workers, not in the sandbox

Proposed 2026-11-02; accepted when the operator merges the PR that adds it. Amends D1 wording of
[0018](0018-v2-pod-first-architecture.md) ("holder pod" becomes "holder": the lease holder is a
worker, not a pod) and the `pod` package of [0019](0019-v2-package-map.md) (it becomes the worker
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

**D8. The agent loop (`packages/agent`) runs on long-lived control-plane workers, not in the
sandbox.** Sandboxes stay on Vercel Sandbox and only execute. Each sandbox runs a small in-sandbox
daemon — exec, files, grep, background shells, services, stdio MCP, terminal, and private
`operator_input` delivery — reached by the worker over one persistent WebSocket.

**Worker host: Render, Virginia region, in the operator's company org (the Comp AI workspace).**
The operator confirmed the shape on 2026-11-02: a new `apps/worker` service (plain Bun, no Nest or
tRPC; a Render Background Worker), with the API staying on Vercel. The alternative considered was
moving the whole API to Render and running loops in it; it is rejected because Render's shutdown
grace caps at 300 s, so every API merge would cut every running turn. A separate worker deploys
rarely and hands off leases within the grace.

**Workers hold the per-session leases of P4.** There are N replicas. The §13 reconciler places
sessions on workers.

**A worker restart is a clean handoff.** On SIGTERM a worker takes no new sessions and pauses
every loop it holds. A loop between steps pauses at once. A loop waiting on the model aborts the
stream when the drain deadline (inside Render's 300 s grace) nears; the partial output is
discarded and the new holder asks again. A loop waiting on a tool does not abort it: the tool runs
in the sandbox daemon, which keeps it running and keeps its result under the call's idempotency key
(`runId:callId`) until a holder confirms receipt. The worker then releases its leases, and a new
holder resumes from the record at the next epoch and collects any pending result instead of
re-running the call. Only an in-flight model stream is lost. "Dispatched, effects unknown" (v1
dispatch recovery) remains only for a sandbox that dies. The `agent` loop's existing pause
(`PauseSignal`, checked at every step boundary) becomes a general handoff pause, and its
`RelocationPaused` outcome is renamed for that purpose in slice 3.

**Input wake and live deltas go through the CP.** The API writes the inbox; the holder is
notified through pub/sub (Redis, which v1 already runs). Render's load balancer assigns a
WebSocket to a random instance, so there is no client-to-worker routing: live deltas flow
worker → pub/sub → API SSE.

**The agent is durable: any turn resumes from the record on any worker.** The design follows
[Pi Durable](https://earendil.com/posts/pi-durable/) (Earendil, 2026-10-01, experimental); Atlas
borrows the pattern, not the package, because Atlas owns its loop and already has a control plane
over Postgres. The guarantees:

| Guarantee                                  | Where it comes from                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| A turn resumes from the record at any step | The loop's step boundaries and `resume` (slice 2)                                                                               |
| A tool's intent is recorded before it runs | `tool-dispatched` is appended before invocation and dispatch fails closed if it is not (slice 2)                                |
| A tool survives a worker death             | The daemon keeps running the call and holds its result under `runId:callId` until a holder confirms receipt (new, slice 3)      |
| A tool is rerun only if safe               | Read-effect calls rerun; others whose sandbox died are reported as interrupted with output so far (v1 dispatch recovery)        |
| Input is consumed exactly once             | CP inbox ids, consumed through `input-consumed` (slice 1)                                                                       |
| One owner at a time                        | The epoch-fenced lease (slice 1)                                                                                                |
| A hook decides once                        | A hook's decision is recorded in the log and the first write wins, so a hook rerun after a restart reads it back (new, slice 3) |
| Timers survive a restart                   | Retry backoff and delivery windows (the PR delivery buffer) are recorded deadlines, not in-memory timers (new, slice 3)         |
| Aborted model output is kept               | A stream cut by a handoff stays in the record marked aborted, and the next holder asks again (new, slice 3)                     |

Atlas goes further than Pi Durable on tools: a Pi tool runs in the harness process and dies with
it, while an Atlas tool runs in the sandbox and outlives the worker that started it.

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
  saturated sandbox must not starve the daemon that the worker's tools call.
- **Slice 3 splits in two**: the worker host (lease, runs the agent, appends to the CP, consumes
  the inbox) and the sandbox daemon (the execution surface over one WebSocket).
- The word "pod" survives as the sandbox; "holder pod" in 0018 and the v2 docs now reads as the
  lease holder, which is a worker.
- The `pod` package of [0019](0019-v2-package-map.md) splits into the worker host and the daemon;
  the rename is fixed in the slice 3 spec.
- Nothing is built by this record. The slice 3 spec is written and approved before building
  starts.
