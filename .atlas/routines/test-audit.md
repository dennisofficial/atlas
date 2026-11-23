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

Ordered by value. Each item fits in one sitting.
1. **Scan specs go stale under CI's incremental run.** `no-chrome-overrides.spec.ts` went red with
   #2645 while main CI stayed green. Likely cause: it reads sources through `Bun.Glob`/`Bun.file`,
   which neither `--changed` import selection nor the recorder
   (`packages/bun-test-incremental/src/fs-env-recorder.ts:129-130`, `node:fs` only) sees.
   Confirm first. The fix is in the runner, so the PR stays open.
2. **Real sleeps, measured 2026-11-23.** Test-only: `overlay-watcher.spec.ts:86-127` (5.9s, sample
   the race grid), `agent-tools/bash.spec.ts:106-121` (3.3s, await group death),
   `use-pod-metrics.spec.ts:120,136` (2.2s each), `use-preview-origins.spec.tsx:102` (5.7s),
   `tool-container.spec.ts:274` (5.4s), `use-process-log.spec.tsx:47,66` (2.6s),
   `workspace-setup.spec.ts:152-166` (23s). Production seam: `app-cloud-tab.spec.tsx:223` (7.8s,
   `SYNC_FEEDBACK_MS`), `sign-in-flow.spec.tsx:63` (6.1s, `MIN_INTERVAL_MS`),
   `runtime-checkpoint-mirror.spec.ts:275` (8.7s, the 5s abandon timeout).
3. **`declared-reality.spec.ts` deadlock** (`packages/harness/src/services/__tests__/`). Four
   specs hang in a nested cloud sandbox but pass on CI. Find the await that never settles first.
4. **Assertion-free bodies: 24 in 18 files.** Top: `github-pr-stream.router.spec.ts:76`,
   `serve-drain-client.spec.ts:138,191`, `serve-hydrate.spec.ts:230`,
   `cloud-service-oauth.spec.ts:88`, `boot-reporter.spec.ts:28`, `pod-rollover-stop.spec.ts:61`,
   `prose-stream.bench.spec.tsx:58,73` (delete), `cloud-oauth-sandbox.spec.ts:52,130`,
   `pod-engine-lifecycle.spec.ts:92,120`. All test-only.
5. **Duplicates.** `ending-hold.spec.ts:140` repeats `:73` under a name its fixture cannot express;
   `registered-plugins.spec.ts` in `apps/api/src/agent` and `packages/pods/src/control`; 16 pairs in
   the web prototype mirror; `sidebar-cache.spec.tsx` vs `v2-sessions-cache.spec.tsx`.
6. **Missing specs, by churn × importers:** `control-plane.module.ts` (22, boot graph),
   `web/.../threads-api.ts` (21 × 19), `agent/host/holder.module.ts` (15),
   `sessions.module.ts` (9 × 25), `thread-message-queue.ts:12-27` `servesLiveIn` (pure),
   `overlay-stack.tsx`, `serve-boot-finish.ts`.
7. **Awaitable tl;dr footer.** `loop/tldr-turn-runner.ts:70-76` has no settle signal, so
   `turn-wiring.spec.ts` keeps two 400 ms waits. Production change; PR stays open.
8. **Drift:** `apps/web/.../use-pod-power.spec.ts` and 85 `packages/github/src` specs sit outside
   `__tests__/`; wall-time asserts in `quality/deadline.spec.ts:139-146` and
   `plugin-resources-turn-start.spec.ts:105,136`; unreset `let pathname` in
   `in-app-notices.spec.tsx:35`.
9. **Over-300-line specs** (212 files). Split as touched, from `remote-delta-channel.spec.ts`.
10. **Slow tail kept on purpose:** `sandbox-client` 10s, `plugin-types/drift` 15s,
    `local-process` 5s, the SSE PR recovery and watchdog specs, `mirror-upload` 0.7–2.4s.

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
- **Caller-abort in `runModelStream`** has three guards (`ai-sdk-model-port.ts:143,163`,
  `stream-ended-without-finish.ts:22`); a single-guard mutation stays green by design.
- **Postgres specs failing with `no test Postgres at localhost:55441`** are environmental. Run
  `bun run --cwd packages/db db:test:up` first.
- **Convention drift:** no `.test.ts(x)`, no Vitest outside `evals/`, `noFocusedTests` blocks
  focused tests. Specs outside `__tests__/` are sanctioned by `apps/api/AGENTS.md`.

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
