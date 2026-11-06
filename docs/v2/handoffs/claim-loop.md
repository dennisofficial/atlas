# Handoff: build 0026 (hosts pull sessions; a held session always settles)

Written 2026-11-05. Read [0026](../../decisions/0026-v2-hosts-pull-sessions.md) first: it is the spec, with
the decision, the proofs and a four-PR build plan. Then [0025](../../decisions/0025-v2-connection-bound-leases.md)
(presence, epoch fence, ring) and [architecture §13](../architecture.md) (wake path, held-session loop).

## Status

0026 is **proposed**. Dennis asked for the root-cause redesign ("fix the underlying disease, not the
symptom") after the recovery fixes below landed. Confirm the decision with him before PR 1 if he hasn't
already said yes on the docs PR, then flip it to accepted in the same PR that starts the build.

## What is already merged (main at 0cea4d305 or later)

| PR    | What it does                                                                                                                                                                                | Fate under 0026                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| #1899 | Daemon link re-wakes a sandbox at most 3 times, then fails visibly; the next call reconnects (`apps/agent-host/src/runtime/rewaking-connector.ts`, `packages/host/src/calls/ready-gate.ts`) | Kept                                                     |
| #1901 | An unawaited call rejected by `close()` no longer raises                                                                                                                                    | Kept                                                     |
| #1903 | `HolderSweep` every 20 s ± 20 %; `auditOwnLeases`; `leasesHeldBy` in control                                                                                                                | Sweep → claim-loop tick; audit → should-never-fire check |
| #1904 | Every exit revokes and stops the runtime (`held-idle.ts` `teardownHeldSession`, `held-release.ts` retry)                                                                                    | Replaced by `runHeld` + `settle` + `settling` set        |
| #1908 | `session-start-failed` record event, status `Failed`, bounded at 5 (`start-failure-record.ts`, `StartBackoff.judge`)                                                                        | Event kept; count moves to the lease row                 |

Background: the [recovery audit](../research/slice-3/recovery-audit.md) ranks 15 findings; F-01, F-02,
F-04, F-06, F-08, F-15 are closed by the PRs above. Its §3 invariant (every session progressing, idle or
failed-visible) is the goal.

## Where to start reading code

- `packages/host/src/holder/session-holder.ts` (≈311 lines, over the 300 limit after #1903/#1908 — PR 2
  should bring it back under): `onWake`, `claimAndHold`, `hold`, `releaseUnstarted`, the sweep wiring.
- `packages/host/src/holder/held-session.ts` (300 lines): `drive`, `step`, `finish`, `teardown`, the flags.
- `held-idle.ts`, `held-release.ts`, `start-backoff.ts`, `start-failure-record.ts`, `own-lease-audit.ts`,
  `holder-sweep.ts`, `needing-holder-list.ts`, `resync-retry.ts`.
- Control: `packages/control/src/lease-ops.ts` (`claimLease`, `initialLease`), `control-plane.ts`
  (`claim`, `sessionsNeedingHolder`, `leasesHeldBy`), `postgres/postgres-needing-holder.ts`,
  `testing/memory/memory-needing-holder.ts`, `testing/conformance/`.
- Core: `packages/core/src/record/lease.ts` (pure `claim`/`grant`/`revoke`); put new pure decisions
  (outcome → lease write, retry delay) there and test them with plain data.
- Tests: holder rig `packages/host/src/holder/__tests__/holder-rig.ts` (`makeRig`, `sweepMs` option,
  default 0 in the rig), fault matrix `apps/agent-host/src/__tests__/faults/` (F1–F27, `exit7`).

## Things that bit the last session

- Biome re-pads markdown tables; prettier must not be run (it reformats unrelated files). Use
  `bunx biome check --write <files>`.
- `apps/agent-host` `client-follow.spec.ts` fails to resolve `@dltech/atlas-client/stream` in the full
  run and has 7 tsc errors on main; it passes alone. Not yours.
- Builders have no `subscribe` tool; the main session subscribes to their PRs.
- Dennis wants builders time-boxed (20–40 min), one slice each, and v2 PRs may be merged without asking
  once CI is green.
- Nothing here has been exercised on production. After PR 3, do a live check: break a session's sandbox
  config (status shows failed), fix it, send a message (answered); and kill a holder mid-turn.

## Still open after 0026 (audit steps 4–7, alongside roadmap slice 4)

Deadlines at every edge (`ready()`, `sandbox.wake()`, drain hard exit, listener/presence connect
timeouts), a progress watchdog (11 min tool call, 3 min silent model step), crash-loop quarantine (falls
out of 0026 D3's bound), the invariant asserted after every fault row, and a v2 Stop API route (none
exists; live tests post `kind: stop` to the inbox directly).
