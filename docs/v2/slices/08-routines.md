# Slice 8 spec: routines (cron-scheduled sessions)

Status: **spec, 2026-11-10.** Approved by the operator in conversation on 2026-11-10 (fresh session
per run; skip while the previous run works; `apps/trigger` built first; a five-minute floor on
frequency). Anchors are `path:line` at `627681376`; re-check before relying on one.

Contract: [0022](../decisions/0022-v2-background-jobs-in-apps-trigger.md) (v2 schedules run on
trigger.dev in `apps/trigger`), [0026](../decisions/0026-v2-hosts-pull-sessions.md) (hosts pull work
from the database), [architecture.md](../architecture.md) §4 P1 (one writer per fact).

## Goal

A routine is a saved prompt plus a cron schedule. At each occurrence Atlas starts a session for it
and the agent works unattended, the same session a person would get from the composer. The operator
creates, edits, disables and deletes routines from web, sees when the next one runs, and sees
whether the last one ran, was skipped, or is still working.

**Exit criterion:**
1. A routine set two minutes out spawns a session with no client open; the session clones the
   project, runs the prompt and settles. Recorded in §8 with the session id.
2. A second occurrence that arrives while the first run is still working records `skipped-busy`
   instead of starting a second sandbox, and the next occurrence still runs on schedule.
3. A routine disabled between dispatch and execution records `skipped` and starts no session; a
   routine deleted leaves its past sessions untouched.
4. The same occurrence dispatched twice (two overlapping sweep runs, or a retried child) produces
   exactly one session.

## 1. What exists today

- **Session creation, v2.** Web's composer calls `sessions.create`
  (`apps/web/src/features/sessions/data/create-session.ts:16`), which is the control-plane router
  `SessionsRouter.create` (`apps/api/src/api/platform/control/sessions.router.ts:31`) →
  `SessionsService.create` (`apps/api/src/api/platform/control/sessions.service.ts:73`) →
  `plane.createSessionWithMessage` (`packages/control/src/control-plane.ts:94`). That writes the
  session, its main thread, the first message as inbox entry 1 and a wake (`createSessionIn`,
  `packages/control/src/session-ops.ts:4`).
- **Unattended execution already works.** A session needs no client to run: hosts pull work by
  predicate (`0026`, `claimNext` over needing sessions), so an unconsumed inbox entry is enough.
  With the user's laptop closed, a routine-spawned session still starts.
- **Status is derived, not stored.** `deriveStatus`
  (`packages/core/src/record/views/derive-status.ts:70`) maps the log plus lease liveness to one of
  `preparing | setup-failed | start-failed | sent | thinking | running-tool | waiting-to-retry |
  waiting-for-credentials | resuming | idle | failed` (`packages/core/src/record/views/status-types.ts:1`).
  Liveness is `holderHostId !== null && hostPresent(holderHostId)`
  (`packages/control/src/lease-ops.ts:78-86`). The session list already ships this per row
  (`SessionDigestRow`, `packages/control/src/port.ts:29`).
- **A one-minute sweep is the house pattern.** `github-poll-sweep` runs `cron: '*/1 * * * *'`
  (`apps/api/src/trigger/github/github-poll-sweep.task.ts:5-7`) inside the v1 trigger app
  (`apps/api/trigger.config.ts:5`, project `proj_yvwotwceptrneuuasamk`).
- **The v2 job home does not exist yet.** `apps/trigger` and `packages/jobs` are named by 0022 and
  absent from the tree; routines is the first v2 job, so part 1 builds them.
- **`packages/control` owns every durable fact of a session** and exposes `store.transact`
  (`packages/control/src/postgres/postgres-store.ts:311-318`); the transaction is the unit in which
  "claim the occurrence, create the session, advance the schedule" can be made indivisible.

## 2. Decisions

1. **A routine is a row, not a deployed schedule.** trigger.dev's dynamic schedules would split
   `nextRunAt` between the platform and the database and need reconciliation on every edit. The row
   is the only source of truth; the sweep is stateless and reads it each tick.
2. **Each run is a fresh session.** Isolated workspace, visible in the session list, dies on its
   own. The cost is a sandbox boot and a repo clone per run; a persistent session per routine would
   keep a sandbox alive around the clock, which is worse.
3. **Overlap: skip, and record it.** A run is "still working" when the previous run's session
   status is anything except `idle`, `failed`, `start-failed` or `setup-failed`. Escape hatch for a
   host that died mid-turn: if the lease is not live and the status has not changed for
   `wedgedAfterMs` (one routine interval, capped at two hours), the run is treated as finished.
4. **Missed occurrences collapse to one.** A due routine always runs once, now, and its schedule
   jumps to the next future occurrence. Three days of downtime produce one run, not three, and no
   grace-window constant is needed.
5. **Five-minute floor on frequency.** At roughly 30 s from create to first token, a one-minute
   routine is a permanent sandbox. The API rejects an expression whose `minimumGapMinutes` is under
   5; the UI shows runs/day next to the cron. Everything at or above five minutes is free-form.
6. **No status column on the routine.** "Is the current run working" is the run session's derived
   status; "what did the dispatcher do" is a `V2RoutineRun` ledger row. Two questions, two owners,
   neither a copy of the other.

## 3. Shape

```
routine-sweep  (schedule, every minute, read-only)
  SELECT due routines → batchTrigger one child each
  idempotencyKey = `routine:<routineId>:<scheduledFor>`   (scheduledFor = the row's nextRunAt)

routine-run    (child, one per routine per occurrence)
  one store.transact:
    lock routine → re-check enabled and nextRunAt > scheduledFor
    busy? → ledger skipped-busy, advance
    else  → createSessionIn + post prompt + ledger started + advance + lastSessionId
  concurrencyLimit('routine-runs', 3) so a burst queues instead of opening N sandboxes
  onFailure: ledger failed + advance, so a broken routine cannot wedge its own schedule

agent host     (exists) pulls the session, boots the sandbox, runs the loop, records start failures
```

Three guards make a duplicate impossible: the idempotency key dedupes an occurrence at
trigger.dev, the locked re-check makes a replayed child a no-op at the database, and the session
write shares a transaction with the advance.

The child never waits for the sandbox. "Did it start" is answered downstream by the session's own
status and the host's bounded start-failure handling (0026 D3); a dispatcher-side watchdog would be
a second liveness system.

### 3.1 Data

`V2Routine` (`packages/db/src/prisma/schema/v2/routine.prisma`): `id, userId, projectId, name,
prompt, cron, timezone, enabled, modelRef?, modelEffort?, modelFast?, nextRunAt, lastRunAt?,
lastSessionId?, createdAt, updatedAt`.

`V2RoutineRun` (`routine-run.prisma`), append-only: `id, routineId, scheduledFor, outcome
(started | skipped-busy | skipped), reason?, sessionId?, at`.

### 3.2 Modules

- `packages/schedule` — pure: `parseCron`, `nextOccurrenceAfter`, `upcomingOccurrences`,
  `minimumGapMinutes`. No deps, no clock. Timezone math over `Intl.DateTimeFormat`.
- `packages/control` — `runRoutine` on `ControlPlane`, the routine methods on `ControlTx` and
  `ControlStorePort` (postgres + memory + conformance), `routine-ops.ts`.
- `packages/jobs` — task ids and zod payload schemas for `routine-sweep` and `routine-run`.
- `apps/trigger` — the two tasks, their graph, the new trigger.dev project, its tier file.
- `apps/api` — `routines` router (`list/create/update/delete/runNow`), protocol schemas.
- `apps/web` — the Routines page: list with live status of the last run, next run, create/edit with
  cron validation and a next-runs preview, enable/disable, delete, open last run. It is a third tab
  in `ShellBottomNav` (`apps/web/src/features/shell/shell-bottom-nav.tsx`, today `Threads` and
  `Projects` from `EAppNav` in `shell-types.ts:1`): `EAppNav.Routines`, a `/routines` route beside
  `app/(private)/projects`, and the sidebar body swapping to the routine list the way it already
  swaps between threads and projects. The Mac shell renders the same web payload and inherits it;
  TUI is out of scope. Placement decided by the operator on 2026-11-10.

## 4. Packaging and the PR sequence

- **Part 1, `feat(trigger):`** `apps/trigger` + `packages/jobs` + heartbeat task + its own tier file
  - deploy workflow. Proves the deploy before any routine code depends on it. The v2 trigger.dev
    project already existed (`proj_muqwamionbikynuchupc`); the deploy authenticates with
    `TRIGGER_ACCESS_TOKEN` and the ref is hardcoded like v1's. Only the project's
    `TRIGGER_SECRET_KEY` is still dashboard-held, for running or inspecting runs.
- **Part 2a, `feat(control):`** `packages/schedule`, the two models + migration, the store methods
  and `runRoutine` with conformance tests. No dispatcher yet, so nothing fires.
- **Part 2b, `feat(trigger):`** the sweep and child tasks, wires schedule + control together.
- **Part 2c, `feat(web):`** the router, protocol schemas and the Routines page.

## 5. Test plan

- `packages/schedule`: parsing (lists, ranges, steps, names, 7-vs-0), DOM/DOW OR, leap day, monthly
  on the 31st, both DST directions in two zones, timezone independence, the five-year never-fires
  bound, `minimumGapMinutes`.
- `packages/control`: conformance for due listing (enabled, order, limit), conditional advance, and
  lock serialisation; `routine-ops` specs for started, disabled, already-ran, busy,
  wedged-not-busy, and two runs of the same `scheduledFor` producing one session.
- `packages/jobs`: payload schema round-trip.
- Live (§8, production): the four exit criteria.

## 6. Out of scope

Attachments, skills or tool selection in the prompt; chaining runs or feeding the previous session's
output into the next; routines that spawn locally; v1 sessions; Mac/TUI surfaces; a push
notification per run (a routine's session already reports its own start failures); per-routine
catch-up policy.

## 7. Open questions

None at approval time. The one deliberate omission is a per-routine "don't run if late" option,
which becomes a field on `V2Routine` if the operator asks for it.

## 8. Live check

To be recorded when part 2c lands: routine id, its session id, the skipped-busy occurrence, the
disabled-mid-flight occurrence, and the timings from dispatch to first token.
