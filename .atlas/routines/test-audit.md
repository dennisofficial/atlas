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
1. **`apps/api/src/agent-boundary.spec.ts:100` is red on main, CI never reruns it.** Six files
   import agent internals: `sessions.service.ts:64`, `pod-provision-rollback.ts:8`,
   `pod-provision-run.ts:29` and `trigger/sandbox-cost/agent37-usage-reconcile.task.ts:7-9`.
   The fix is production (export through `agent/index.ts`), so the PR stays open for Dennis.
   Likely cause: the spec scans directories at runtime, so CI's `--changed` selection skips it.
2. **`declared-reality.spec.ts` deadlock** (`packages/harness/src/services/__tests__/`). Four
   specs hang in a nested cloud sandbox but pass on CI. Find the await that never settles first.
3. **Real sleeps, measured 2026-11-20.** Test-only: `use-preview-origins.spec.tsx:102`
   (4.7s, fake timers), `tool-container.spec.ts:270-274` (3.2s, await dispose),
   `use-process-log.spec.tsx:47` (2.3s), `workspace-setup.spec.ts:153-166` (15s poll loops).
   Production seam needed:
   `serve/runtime-checkpoint-mirror.spec.ts:275` (7.2s file, the 5s abandon timeout).
4. **Assertion-free specs: 19 left.** Top: `stream-ended.spec.ts:80` (assert
   `{ parts: [], toolCalls: [], finishReason: 'other' }`), `github-pr-stream.router.spec.ts:76`,
   `serve-drain-client.spec.ts:138,191`, `serve-hydrate.spec.ts:230`,
   `cloud-service-oauth.spec.ts:88`, `boot-reporter.spec.ts:28`, `pod-rollover-stop.spec.ts:61`,
   `prose-stream.bench.spec.tsx:58,73`.
5. **Awaitable tl;dr footer.** `loop/tldr-turn-runner.ts:70-76` has no settle signal, so
   `turn-wiring.spec.ts` keeps two 400 ms waits. Production change; PR stays open.
6. **Duplicates in `apps/*`.** 16 near-identical spec pairs, mostly the web prototype mirror.
   Also diff `sidebar-cache.spec.tsx` against `v2-sessions-cache.spec.tsx`.
7. **Composition roots without a spec:** `apps/tui/src/composition/overlay-stack.tsx` and
   `apps/serve/src/serve-boot-finish.ts`.
8. **Over-300-line specs** (212 files). Split as touched, from `remote-delta-channel.spec.ts`.
9. **Slow tail kept on purpose:** `sandbox-client` 10s, `plugin-types/drift` 15s,
   `local-process` 5s, the SSE PR recovery and watchdog specs, `mirror-upload` 0.7–2.4s.

## Ruled out — do not re-investigate

- **`apps/api/src/agent/agent-tools/__tests__/*`** are not dead clones; the fork is live
  (`apps/api/src/agent/runtime/tools.ts:18-25`).
- **`lockstep-stream.spec.ts` and `packages/control/__tests__/memory.spec.ts`** have no `expect`
  but assert by throwing or through shared conformance suites.
- **`apps/daemon/src/__tests__/conformance-bundle.spec.ts:14`** `it.skip` guards an unbuilt bundle.
- **The 13 `adapter.available ? describe : describe.skip` gates** in
  `packages/harness/src/shells/__tests__/` are a deliberate platform seam.
- **No vault KDF cost in `packages/harness/src/cloud/__tests__/`.** It was retry backoff.
- **Expect-free bodies that do assert:** the `packages/syntax` lexical specs (`expectLexes`), and
  specs that wait with throwing `waitFor`/`until`/`frameWhen`/`expectUntil` helpers.
- **Postgres specs failing with `no test Postgres at localhost:55441`** are environmental. Run
  `bun run --cwd packages/db db:test:up` first.
- **Convention drift:** no `.test.ts(x)`, no Vitest outside `evals/`, `noFocusedTests` blocks
  focused tests. Specs outside `__tests__/` are sanctioned by `apps/api/AGENTS.md`.

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
