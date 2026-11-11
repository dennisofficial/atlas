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

Recorded 2026-11-10 against production (`api.byatlas.io`, trigger.dev `proj_muqwamionbikynuchupc`)
on `5bd544c28` (`feat(routines): run a saved prompt on a cron schedule`, #2215). Routine
`5c2ed493-8d5b-4af3-a27e-3bbb5ca83f74`, cron `*/5 * * * *` in UTC, prompt: run the workspace test
suite at the repository root and report per-package pass/fail counts and wall time.
1. **A routine spawns a session with no client open — produced.** Occurrence 21:45:00Z; the
   dispatcher wrote session `bf43a4fb-9dea-48e5-bab8-868e72a2051d` at 21:45:49Z and nothing else
   touched it. The host pulled it: `preparing` 21:45:49 → `thinking` 21:46:34 → `running-tool bash`
   21:46:41 → `idle` 21:56:48. Boot to first model turn 45 s; the run took 10 m 59 s and left 66
   events, the prompt verbatim first.
2. **A second occurrence during a live run records `skipped-busy` — produced.** The 21:50:00Z
   occurrence arrived while the first run was in `running-tool` (`running-tool` still at 21:50:40Z).
   Ledger row `c13dd213-b41b-4d00-a7ab-55039d46ab47`: `skipped-busy`, reason `running-tool`, no
   session, at 21:50:52Z; `nextRunAt` advanced to 21:55:00Z and the cadence continued.
3. **Disabled between dispatch and execution records `skipped`; deleting leaves sessions
   intact — partly produced.** Deleting is proven: `routines.remove` returned `{removed: true}`,
   `sessions.list` still returns `bf43a4fb` with its `routineId`, and the ledger went with the
   routine. Disabling stops dispatch: with `nextRunAt` at 21:55:00Z and 22:00:00Z and the routine
   disabled seconds after each minute, no occurrence was dispatched and no ledger row appeared. The
   disabled-mid-flight `skipped` row was **not** produced live: a `*/1` schedule starts ~45 s into
   the minute and its child's transaction follows within a second, so the window between dispatch
   and execution is sub-second from outside. Producing it would need a child queued behind
   `concurrencyLimit(routine-runs, 3)` or a hand-triggered run, the latter needing the project's
   `TRIGGER_SECRET_KEY`, which is dashboard-only. The path is covered on both stores by
   `conformance-routine-crud` and `routine-ops` (`disabled`, `already-ran`).
4. **The same occurrence dispatched twice produces exactly one session — not produced live.** Same
   obstacle in reverse: a second dispatch needs two overlapping sweeps or a hand-triggered child.
   Both guards are covered: `runRoutine` twice for one `scheduledFor` yields one session (conformance,
   memory and Postgres), and the sweep sets trigger.dev's idempotency key per occurrence
   (`routine:<id>:<scheduledFor>`).

Operational note: a trigger.dev `*/1` schedule starts its run ~45 s past the minute, so an occurrence
due at `T` produces its session near `T+50 s`, not at `T`.

## 9. Follow-up, 2026-11-11: a sentence, a default zone, and the agent

Approved by the operator on 2026-11-11 in conversation. Three changes, none of which touch the
dispatcher, the schema or the API contract.
1. **The schedule is typed the way it is said.** The form's schedule control is a text input
   ("every weekday at 7am", "every 15 minutes", "first of the month at 8", or a raw five-field
   expression). `parseScheduleText` (`packages/schedule/src/text.ts`) turns it into a cron with no
   model call, no network and no clock; the preview below it confirms the runs the dispatcher would
   take. The preset picker stays as the escape hatch — it opens when the sentence cannot be read and
   is one click away otherwise — so nothing that used to be possible became impossible. Editing an
   existing routine opens as the sentence its cron means
   (`scheduleSummaryOf`), and every phrase the app writes parses back to the cron it wrote.
2. **The timezone defaults to a user setting, not the browser.** `web.routine.timezone`
   (`packages/wire/src/web/web-only-settings.ts`) is a personal setting edited at Settings → Agent →
   Routines; empty means the device's zone. A new routine opens in that zone, and a run keeps its
   wall-clock time in the routine's own zone, so travelling does not move an existing routine.
3. **Agents manage routines too.** See §9.1.

### 9.1 The agent's routine tools

Five builtin tools in `packages/harness/src/tools/builtin/routine-*.ts`, registered by
`registerRoutineTools` (`packages/harness/src/routines/register.ts`) beside the subscription tools in
`register-tools.ts`. They reach the control plane the way `cloud_config` does: the pod already holds
an `ApiClient` for the signed-in session (`routineAccessOf`, mirroring
`packages/harness/src/cloud/cloud-config-access.ts`), and each call goes through `cloudCall` so an
API refusal arrives as `ok: false` with its message instead of an exception.

| Tool             | Effect | What it does                                                                                                                       |
| ---------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `routine_list`   | read   | The session project's routines: id, name, cron, timezone, enabled, next run, last run's session                                    |
| `routine_create` | write  | name, prompt, cron, timezone (required — no invented default), optional model/effort/fast/enabled                                  |
| `routine_update` | write  | any subset of the create fields plus `enabled`, at least one; `model`/`effort`/`fast` set to null fall back to the account default |
| `routine_delete` | write  | deletes the routine, leaving its past sessions                                                                                     |
| `routine_run`    | write  | starts one run now, off schedule, and returns the session id                                                                       |

Scope is the session's own project: a session without one gets a plain refusal, and nothing in the
tool can name another project. Validation is the API's, which is the point — the five-minute floor,
cron parsing and the timezone check live in one place (`routines.service.ts`), so the tools inherit
them instead of restating them.

No classifier change was needed: a tool with `TAKES_NO_PATHS` and no deeds of its own yields
`EDeed.Routine`, which the prefilter already treats as quiet, exactly as `cloud_config` and
`subscribe` are treated. Only `EToolEffect` differs — `routine_list` is Read and concurrency-safe; the
four writers are Write.
