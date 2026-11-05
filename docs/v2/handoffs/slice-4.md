# Handoff: Atlas v2 after slice 3 (exit tests, then slice 4, views)

Written 2026-11-04 at the end of the slice 3 build day. Read [`../README.md`](../README.md), then the
[roadmap](../roadmap.md) Current state, which carries the live numbers and the decisions below in short
form. The spec is [`../slices/03-agent-host.md`](../slices/03-agent-host.md). Earlier handoffs:
[`slice-3-pr4.md`](slice-3-pr4.md), [`slice-3-pr3/`](slice-3-pr3/).

## Where things stand

Slice 3 is built and merged (#1735 to #1846), and the roadmap table says "In progress (exit tests)". The
agent host runs real sessions on Render against production Postgres and Vercel sandboxes. Two live runs
succeeded: tools through the daemon (bash, write, read, edit, grep), a hot turn, and a new session prepared
before its first turn. The fault matrix F1–F21 runs locally against real processes; rows that cannot fit
in about 20 s run when `ATLAS_FAULT_TESTS=1`, which the nightly sets.

## What slice 3 left

- **Live exit tests 8 (append p99), 9 (hog in a real sandbox) and 10 (claim and one step at 20k events).**
  None has run live. Exit test 9 needs `ATLAS_LIVE_SANDBOX=1`. Exit test 10 sets `AGENT_HOST_MAX_SESSIONS`.
- **The starred fault rows on Render with a real sandbox:** F10, F11, F12, F18, F19 and F21.
- **F9 is rewritten:** the spec row still says "wake by reconcile"; it now reads "Redis down: unaffected",
  because no wake path uses Redis. Edit the spec row when the live rows run.
- **Parked-session numbers (measured 2026-11-05).** Post to `user-said` 3.0 s on a parked session with no
  holder, most of it claim and config; the model starts while the sandbox resumes and the first tool waits for
  the daemon (2.8 s here). Shortening claim-to-first-turn is the next latency target.
- Delivery step 4 of the spec is not finished: run the live tests above, then flip the roadmap row to Done.

## Known follow-ups

- **F20 flake watch.** F20 (stop during an outage) and F4 flaked on their own observation windows; #1846
  widened the windows and changed no product timing. Watch the nightly before trusting either.
- **`mac-app-rehearsal` runner stalls.** The CI rehearsal job has stalled on its runner; #1830 sped it up.
  The stalls are not investigated.
- **Setup failure is visible but has no UI.** `sessions.status` reports `setup-failed` with the reason and
  a live `setup-failed` frame is sent; no client renders it yet. Slice 4 views and slice 5 clients pick it up.
- **Single-statement lease renew** (one round trip instead of five) is a possible hardening. Not needed:
  #1822 scaled F8's lease window and it passes 10/10. A dedicated lease pool was tried on
  `dennis/v2-lease-pool` (unmerged) and made no difference, so it was not shipped.
- **Browsing the files of a parked sandbox** (a workspace mirror) is proposed, not scheduled.
- `packages/core/src/assembly/rules/messages-from-events.ts` is 453 lines, over the 300-line limit in
  `CLAUDE.md` (449 before slice 3); split it when next touched.
- v1's tool copies in `apps/agent-host/src/agent-tools/` are a fork and will drift from v1 by design.

## Decisions made on 2026-11-04

Operator decisions:
- **Wakes are event-driven through Postgres `LISTEN`/`NOTIFY`.** No polling; it must feel instant. Redis
  carries live frames only. Reconcile stays as the crash net. This amends 0021 and 0022 (see 0021, Amendments).
- **v1 and v2 share no logic.** v1 has its own copy of the loop (`packages/agent-v1`); `packages/agent` is
  v2-only; v1 is cut once v2 is stable. `core` is still shared. Guard: `scripts/check-package-split.ts`, in
  `bun run lint`, with an allowlist that is now empty (#1844, #1845).
- **A session is prepared before its first turn** (#1836), and a failed setup is surfaced, not logged.

Design decisions made while building:
- **Retry key** is `retry:<threadId>:s<baseSeq>[.r<n>]:<attempt>`, not keyed on `runId`, because a new holder's
  run has a new id. `baseSeq` is the seq of the last owned `assistant-said` before the step. A recalled
  expired deadline keeps its attempt count. A model step aborted with reason `'handoff'` ends the turn as
  `HandoffPaused`, never `run-failed`.
- **Blobs:** spill happens on the host before hash-chaining; the record holds `{ $blob: { hash, size,
  preview } }`; only fields typed `unknown` spill (`tool-called.input`, `tool-result.output`,
  `fact-recorded.value`). "The model sees what it saw" means canonical-JSON equivalence. Read
  authorization uses the append-time table `v2.V2BlobRef { sessionId, hash }`, never a text search.
- **API pages** are budgeted in UTF-8 bytes (hard ceiling 3.5 MB serialized). A single event over the ceiling
  returns as `{ seq, type, oversized: { bytes } }`; `sessions.post` text is capped at 1 MB; batched calls
  to `sessions.events` and `sessions.blob` are refused.
- **SIGTERM keeps partial output:** appends get a grace past the drain deadline,
  `retryUntil = min(drainDeadline + 10 s, fenceDeadline)`, so the aborted step is recorded instead of
  tripping `onLeaseLost`. A self-fence detaches running daemon calls before aborting the turn.
- **Pool poisoning (#1821):** the shared `createPool` evicts destroyed sockets and keeps connections alive
  for every caller. Transaction retry is not global, because v1 callbacks make HTTP and Redis calls inside
  `transaction`; it lives only in `PostgresControlStore.transact`, whose callbacks are database-only. The
  agent host sets a 10 s `queryTimeoutMs`.
- **Fault rows use scaled timings** so the matrix runs in CI; a row that cannot fit in about 20 s is gated on
  `ATLAS_FAULT_TESTS=1`.
- **Idle sessions stay parked across a deploy** (#1846): drain hands off only sessions with work.
- **Parked turns do not wait for the sandbox** (#1841); tool calls still wait for the daemon.

## Where slice 4 starts

Slice 4, Views, is next in the [roadmap table](../roadmap.md): status, the context meter
(`contextMeterOf` in `core/src/record/context-meter.ts`), the session's checkout set, PR links and the
subscriptions summary as folds in `core`, materialized by the CP at a log position. Exit: every field v1
clients derive by heuristic is a view or shown as unknown, and the incident's branch and PR link appear from
the log alone. Session status is already a fold (`ESessionStatus` in `core/src/record/session-status.ts`,
now with `preparing` and `setup-failed`), so start there. Slice 4 can proceed while the live exit tests
finish; they touch different code.

## How the operator works

Same as [`slice-3-pr4.md`](slice-3-pr4.md): time-box builders, one slice per brief, merge v2 PRs when v1 is
unaffected and verified, never force-push or `--no-verify`, touch only Dennis's rows in production, and
check deploys yourself through the Render, trigger.dev and Vercel APIs.
