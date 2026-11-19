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
1. **`declared-reality.spec.ts` deadlock**
   (`packages/harness/src/services/__tests__/declared-reality.spec.ts`). Four specs hang in a
   nested cloud sandbox but pass on CI and on clean main. First find the await that never settles,
   using a rented runner or a macOS host. Change the specs only after that.
2. **Awaitable tl;dr footer.** The detached footer write in `TldrTurnRunner`
   (`loop/tldr-turn-runner.ts:70-76`) has no settle signal. Adding one would let the two absence
   cases in `turn-wiring.spec.ts` drop their 400 ms waits. This is a production change, so the PR
   stays open for Dennis.
3. **Duplicates in `apps/*`.** There are 16 near-identical spec pairs, and the prototype mirror of
   the web feature specs is the largest group. Merge each pair and keep the copy nearest its
   source.
4. **Assertion-free specs.** There are 21 dead or tautological specs in `packages/*`, plus 11 in
   `apps/*` and `plugins/*`. Each one gets a real assertion or is deleted.
5. **Composition roots without a spec:** `apps/tui/src/composition/overlay-stack.tsx` and
   `apps/serve/src/serve-boot-finish.ts`.
6. **Over-300-line specs** (212 files). Split them as they are touched, starting with
   `packages/client/src/channel/__tests__/remote-delta-channel.spec.ts` (976 lines).
7. **Slow tail kept on purpose.** Re-check only if it grows:
   - `sandbox-client.spec.ts`: 10s, a real `AbortSignal.timeout`.
   - `plugin-types/drift.spec.ts`: 15s, runs the generator.
   - `local-process.spec.ts`: 5s, a SIGKILL grace period.
   - The SSE PR recovery and watchdog specs.
   - `mirror-upload`: 0.7–2.4s.

## Ruled out — do not re-investigate

- **`apps/api/src/agent/agent-tools/__tests__/*`** are not dead clones. The fork they test is live
  (`apps/api/src/agent/runtime/tools.ts:18-25`).
- **`lockstep-stream.spec.ts` and `packages/control/__tests__/memory.spec.ts`** contain no `expect`
  but are not dead. One throws past a deadline. The other runs the shared conformance suites.
- **`apps/daemon/src/__tests__/conformance-bundle.spec.ts:14`** has an `it.skip` that guards an
  unbuilt bundle. It is legitimate.
- **The 13 `adapter.available ? describe : describe.skip` gates** in
  `packages/harness/src/shells/__tests__/` are a deliberate platform seam.
- **There is no vault KDF cost in `packages/harness/src/cloud/__tests__/`.** The slow cluster was
  retry backoff, fixed on 2026-11-18.
- **Convention drift:** no `.test.ts(x)` files, no Vitest outside `evals/`, and focused tests are
  blocked by `noFocusedTests`. Specs outside `__tests__/` are sanctioned by `apps/api/AGENTS.md`.

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
