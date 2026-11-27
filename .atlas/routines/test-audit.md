# Test-suite audit

A daily routine audits the live spec suite. The backlog and ruled-out list below are rewritten
each run. Each run then adds one dated entry of at most 10 lines, dated in America/New_York.
`deprecated/` is out of scope.

## The standard

A spec earns its place by failing when the behaviour it names breaks. A good unit spec:
1. **Asserts observable behaviour**: a return value, published output, thrown error or persisted
   record. It does not assert call order or private state.
2. **Never mocks the unit under test**, and mocks only what cannot be real: a model, a clock or a
   network.
3. **Cannot pass when the behaviour is broken**: no literal compared with itself, no unread
   snapshot, no `await` without an assertion.
4. **Is deterministic**: no real sleeps, wall-clock races, file-order dependence or module-level
   mutable state.
5. **Fails for one reason**, and its name says which behaviour broke.
6. **Runs fast**: unit specs take milliseconds. A spec over 1s is integration-shaped or pays for a
   fixable cost.
7. **Sits where its subject lives**: `*.spec.ts(x)` in a sibling `__tests__/`.

## Backlog

Ordered by value. Each item fits in one sitting. Rechecked 2026-11-27.
1. **Confirm the cache fix on main.** The first main run after the store change is a full run (the
   package is a global input). From the second run on, `changed: env` and one-time file changes
   must stop rerunning on shards 1–7. If they still do, read the `since the pass of` date.
2. **`follow-live.spec.ts` "resumes after reconnect" hit `deadlock detected` (40P01)** on main run
   45988514717, shard 6: an AccessExclusiveLock against an AccessShareLock, so two specs share
   tables in the test database. Find the spec that truncates or drops while it reads.
3. **34 specs are never cached** because they start a child process: `bunx prisma db sign` (about
   12 db-backed api and `packages/db` specs), `ssh-keygen` (6 ssh-signing-key specs), git and `sh`
   in the daemon specs. Measure what they cost each run, then pick the largest.
4. **Scan specs go stale under CI's incremental run.** `no-chrome-overrides.spec.ts` went red with
   #2645 while main CI stayed green. Likely cause: it reads sources through `Bun.Glob`/`Bun.file`,
   which the recorder (`packages/bun-test-incremental/src/fs-env-recorder.ts`, `node:fs` only)
   does not see. Confirm first.
5. **Real-clock upper bounds (flaky).** `plugin-resources-turn-start-ready.spec.ts:76,120,173`,
   `follow-live.spec.ts:169` (<1s), `transaction-deadline.spec.ts:67`, `crew-takeover.spec.ts:228`,
   `live-model-port.spec.ts:186-188`, `quality/deadline.spec.ts:139-146`,
   `plugin-resources-turn-start.spec.ts:105,136`; new: daemon `service-ready-exit.spec.ts:36`,
   `ops/services/__tests__/port-probe.spec.ts:67`.
6. **Real sleeps.** Test-only: `workspace-setup.spec.ts` (23s; 15s poll helpers),
   `agent-tools/bash.spec.ts:106-121` (3.3s), `use-preview-origins.spec.tsx:102` (5.7s),
   `agent37-wake-abort.spec.ts:183,199`, `handoff-bash-deadline.fault.spec.ts:74` (2s),
   `f20b-stop-then-handoff.fault.spec.ts:122` (1.5s, new), `exec-deadline.spec.ts:77` (1.2s),
   `handoff-pod-resize-idle.fault.spec.ts:139` (1s), `crew-takeover.spec.ts:354` (600 ms),
   `pg-host-watch.spec.ts:158-219`, daemon `quiet()` 900 ms in `ops/watch/tree.spec.ts:16` and
   `ops/git/git.spec.ts:47`, `previews.spec.ts:332` (1.4s), `context-mirror.spec.ts:209-228`,
   `held-observation-context.spec.ts:95`. Production seam: `sign-in-flow.spec.tsx:63` (6.1s).
7. **Duplicates.** `registered-plugins.spec.ts` in api, mobile, web and `packages/pods/src/control`;
   `passes prisma db verify --strict` byte-identical in `drop-v2-views.spec.ts:177` and
   `move-v2-tables.spec.ts:221` (180s each); the web prototype mirror pairs.
8. **Missing specs, by churn × importers:** `packages/control/src/postgres/postgres-rows.ts`,
   `holder/held-runner.ts:57` `ranQueuedCommand`, `control/src/inbox-ops.ts`,
   `holder/staged-log.ts`, `postgres-digests.ts:12` `likePatternOf`.
9. **Drift:** specs outside `__tests__/` in `apps/web/.../data/use-pod-power{,-stop}.spec.ts` and
   the `packages/github/src` top-level specs; unreset `let pathname` in `in-app-notices.spec.tsx:35`;
   `prose-stream.bench.spec.tsx` is an env-gated `console.log` bench with no assertion.
10. **Over-300-line specs** (~120 files). Split as touched, from `remote-delta-channel.spec.ts`.

## Ruled out — do not re-investigate

- **`apps/api/src/agent/agent-tools/__tests__/*`** are not dead clones; the fork is live
  (`apps/api/src/agent/runtime/tools.ts:18-25`).
- **No `expect`, but asserts:** `lockstep-stream.spec.ts`, `packages/control/__tests__/memory.spec.ts`,
  `ssrf.spec.ts` (`blocked` throws), `sessions.service.archived.spec.ts:77`, `fixture-run.spec.ts:234`,
  `port-registry.spec.ts` (type-level `Expect`), the `packages/syntax` lexical specs, and bodies that
  wait with throwing `waitFor`/`until`/`frameWhen`/`expectUntil` helpers.
- **Not duplicates:** the `classifier` jev/openai pairs and the `purity-guard` pair. The 91
  `toHaveBeenCalledTimes` sites assert collaborators beside a state assertion.
- **`apps/daemon/src/__tests__/conformance-bundle.spec.ts:14`** `it.skip` guards an unbuilt bundle.
- **The 13 `adapter.available ? describe : describe.skip` gates** in
  `packages/harness/src/shells/__tests__/` are a deliberate platform seam.
- **No vault KDF cost in `packages/harness/src/cloud/__tests__/`.** It was retry backoff.
- **`agent-boundary.spec.ts`** is green on main since 2026-11-23.
- **The overlay stale-frame guard** is checked twice (`overlay-watcher.ts:98,146`); a single-guard
  mutation stays green by design, both broken turns `overlay-ordering.spec.ts` red.
- **`describe.skipIf(REDIS_URL === undefined)`** in the api fault and redis specs is an env gate.
- **Caller-abort in `runModelStream`** has three guards (`ai-sdk-model-port.ts:143,163`,
  `stream-ended-without-finish.ts:22`); a single-guard mutation stays green by design.
- **Shimmer teardown is triple-guarded** (effect cleanup on unmount, null ref, `isDestroyed` in
  `shimmer-line.tsx:31`); `renderer.destroy()` unmounts first, so a single-guard mutation stays green.
- **Postgres specs failing with `no test Postgres at localhost:55441`** are environmental. Run
  `bun run --cwd packages/db db:test:up` first.
- **Not untested:** `threads-api.ts` has a spec; `overlay-stack.tsx` was deleted in #2791;
  `control-plane.module.ts`, `holder.module.ts`, `sessions.module.ts` are DI wiring only.
- **No snapshots exist** (`toMatchSnapshot` has no use), so there are no unread snapshots.
- **Convention drift:** no `.test.ts(x)`, no Vitest outside `evals/`, `noFocusedTests` blocks
  focused tests. Specs outside `__tests__/` are sanctioned by `apps/api/AGENTS.md`.

- **`changed: env` on a spec that reads ~90–140 variables** is not a per-job variable. Those specs
  enumerate `process.env`, and the record they were compared to was a stale one (fixed 2026-11-27).

## 2026-11-27

- **Only shard 8's records survived in CI.** Each shard restores all eight caches in order, and
  shard 8's archive holds a stale copy of every record file, so it replaced what shards 1–7 wrote:
  62% of api files reran (7,130 of 11,507 in 4 runs); 59 dependants of one change reran every run.
- **Fix:** one record per file, named by its content (`store.ts`), so a stale copy cannot replace a
  newer record. A miss now names the pass it compared to. A two-shard tar replay reran shard 1 on
  every run on main and reused everything with the fix.
- Main test job, last 4 runs: 3m27s–4m18s per shard. Main 45988514717 red on a follow-live deadlock.
- Audit of 135 specs changed since 11-26: no new skips or assertion-free bodies, 2 new clock bounds.
- Mutation checks: 4 store breaks, each turned `store.spec.ts` red. They are listed in the PR.

## 2026-11-26

- **`shimmer-line.spec.tsx`:** the teardown case asserted nothing; it now asserts no paint after
  `renderer.destroy()`. "stops drawing once the line is gone" asserted the opposite (frames keep
  growing); it now unmounts the line and asserts no paint and no text. Tick waits replace 400 ms
  sleeps (2.0s → 1.0s). 10 reruns green.
- **`mcp-oauth-per-server.spec.ts:116`:** dropped `expect(servers).toBeDefined()` on a fixture.
- Audit of 382 specs changed since 11-25: no new skips, no assertion-free bodies, 10 sleeps ≥100 ms,
  one new flaky real-clock bound (backlog 2).
- Mutation checks: leaking the ticker plus painting past the ref guard turns both cases red; each
  single guard alone stays green (ruled out). Listed in the PR.

## 2026-11-25

- **`FollowRig.settled()`: a 30 ms `Bun.sleep` → a macrotask drain** that returns after 3 quiet
  turns of the rig's counters. `apps/api/src/agent/stream/__tests__` (17 files, 126 calls):
  13.2s → 1.85s; the overlay race case 5.8s → <0.2s. 10 reruns green.
- **`boot-reporter.spec.ts:28`** now asserts report returns while the sink is blocked; before, a
  regression showed only as a 5s timeout.
- **`holder-claim-loop.spec.ts:165`:** dropped `expect(THREAD_ID).toBeDefined()` and two dead constants.
- Audit of 539 specs changed since 11-24: no new skips, no new assertion-free bodies, ~95 sleeps.
- Mutation checks: 5 product breaks, each turned the owning spec red. They are listed in the PR.
- The overlay stale-frame guard is doubled (`overlay-watcher.ts:98,146`); only both broken goes red.

## 2026-11-24

- **`use-pod-metrics.spec.ts`: 9.9s → 0.34s.** Fake timers replace four 2.2s sleeps. The specs
  now pin the exact 2s resubscribe edge and the 4s second backoff (which was not asserted before).
- **Deleted the duplicate in `ending-hold.spec.ts:140`**, a byte copy of `:73`.
- **`support-modules.spec.ts:69`:** dropped `expect(THREAD).toBeDefined()` on a module constant.
- Tried fake timers in `use-process-log.spec.tsx`; the fixture's `mount` never renders. Reverted.
- Audit of the 1,230 specs changed since 11-23: no new skips, no assertion-free bodies, 10 new sleeps.
- Mutation checks: 6 product breaks, each turned the owning spec red. They are listed in the PR.

## 2026-11-23

- **`no-chrome-overrides.spec.ts` was red on main since #2645** (`rotation-divider.tsx:21`
  `<Collapsible> gap-2`); CI stayed green (backlog 1). Allowlisted with a reason: Collapsible has no layout.
- **`stream-ended.spec.ts:80`** now asserts the empty result of a caller-aborted stream.
- **Deleted the `qualityNoticeOf` block in tui `quality-indicator.spec.tsx`**, a byte copy of
  `packages/client/.../quality-notice.spec.ts`.
- Mutation checks: 5 product breaks, each turned the owning spec red. They are listed in the PR.
- Audit of the 980 specs changed since 11-20: no tautologies, no new skips, no order assertions.

## 2026-11-20

- **`routine-service.spec.ts` was red on main from 09:00Z** (hard-coded next run). It now pins
  the clock with `setSystemTime`, and the re-enable case asserts the exact next Monday.
- **`sessions-subscription.spec.ts` was red after #2466** made Agent37 the default provider.
- Main CI stayed green: its last run (08:56Z) beat the 09:00Z date, and `--changed` selection
  did not pick `sessions-subscription` up. Unit specs must never read the real clock.
- **`mark-read-scheduler.spec.ts`:** replaced `expect(true).toBe(true)` with a check that a
  failed send leaves the scheduler sending later heads.
- **Deleted `apps/tui/.../zz-debug.spec.tsx`**, a 2.6s `console.log` frame dump with no assertion.
- Mutation checks: 6 product breaks, each turned the changed spec red. They are listed in the PR.

## 2026-11-19

- **`cloud-user-settings-store.spec.ts`: 2.2s → 0.3s** (former backlog item 3).
  - The `settled()` helper used to wait out `50 × Bun.sleep(5)`. Now it counts open fetches and
    returns once none has been open for 3 macrotask turns. It throws if the chain never settles.
  - The sign-in-change case now awaits the gated PUT arriving.
  - Six product mutations each made the spec fail:
    1. Drop `onChange` after a failed write.
    2. Ignore the token check.
    3. Never delete dropped keys.
    4. Forget `lastSeen` mid-refresh.
    5. Skip `writeRemote`.
    6. Return local-only keys.
- **Deleted `apps/tui/.aspect/a.spec.tsx`.** It was a 2025 scratch probe that `bun test` never
  discovers (dot-directory). It had no assertions and read an image from `$HOME`.
- **Date fix.** Both earlier entries were dated in UTC. In New York time both ran on 2026-11-18.

## 2026-11-18 (second run)

- Added `register-tools.spec.ts` (6 tests) and `compose-serve.spec.ts` (5 tests). Each was
  mutation-checked.
- `packages/harness/src/cloud/__tests__/*` went from 39.6s to 23.1s. The cost was real retry
  backoff, not a KDF. The fix threads the existing `sleep` seam of `createRetryingFetch` through
  the cloud clients.
- Replaced polling with awaited signals in `lockstep-stream`, `shell-registry-release` and
  `turn-wiring`. The `turn-wiring` presence case was converted. Its two absence cases keep a
  400 ms wait.

## 2026-11-18

- Baseline: 3,695 spec files, ~233k lines. `packages/core` has 336 files and 3,537 tests and runs
  in 86s.
- Deleted the duplicate `harness/execution/serve-priority.spec.ts` and the empty skipped
  `app-cloud-birth-preflight.spec.tsx`.
- Fixed the tautological "names every entry" test in `port-registry.spec.ts`. It now uses
  `satisfies` plus a type equality check.
- Added `turn-wiring.spec.ts` (9 tests).
