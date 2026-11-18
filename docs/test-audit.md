# Test-suite audit

A dated, append-only audit of the live spec suite, run as a daily routine. Each entry records what
was measured, what was fixed that day, and what is queued — so the next run starts from the backlog
instead of re-deriving it. `deprecated/` is frozen prior art and out of scope in every entry.

## The standard

A spec earns its place by failing when the behaviour it names breaks. Concretely, a good unit spec:
1. **Asserts observable behaviour** — a return value, published output, thrown error, persisted
   record. Not that a collaborator was called in a particular order, not private state.
2. **Never mocks the unit under test**, and mocks only what cannot be real (a model, a clock, a
   network). Pure `core` decisions are tested as plain data.
3. **Cannot pass when the behaviour is broken** — no literal-against-itself assertions, no snapshot
   nobody reads, no `await` with no assertion, no compile-time-only check dressed as a runtime one.
4. **Is deterministic** — no real sleeps, no wall-clock races, no dependence on file order or
   module-level mutable state.
5. **Fails for one reason**, and its name says which behaviour broke.
6. **Runs fast** — unit specs are milliseconds; anything taking >1s is either integration shaped
   (say so in the name or the directory) or paying for a fixable cost.
7. **Sits where its subject lives** — `*.spec.ts(x)` in a sibling `__tests__/`, next to the module.

## 2026-11-18

Baseline measured today, before any change: **3,695 live spec files, ~233k lines**, `bun test`
through `bun:test`, incremental cache in CI, nightly full run (`tests-nightly.yml`).
`packages/core` alone: 336 files / 3,537 tests / 86s. Focused tests (`.only`) are already blocked by
`noFocusedTests` in `biome.json`, so that class of drift cannot happen.

### Verdict on the four axes

- **Best practice / dead tests.** The suite is in good shape overall: no snapshot testing, only five
  files use `mock.module`, `core` genuinely tests decisions as data. The dominant weakness is not
  the dead spec but the **assertion-free spec**: 13 dead + 8 tautological in `packages/*`, 8 dead +
  3 tautological in `apps/*` + `plugins/*` — tests that a reader counts as coverage and that cannot
  fail. Second weakness is **duplication that reads as independent coverage** (16 near-identical
  pairs in `apps/*`).
- **Slow tests.** Measured table below. The suite is dominated by a handful of genuinely expensive
  integration-shaped specs (a plugin-type generator comparison, a wedged-connection timeout, a
  SIGKILL grace period) rather than by thousands of sleepy unit specs. The recurring _fixable_
  pattern is **polling to observe a value**: `until()`/`footerWithin()`/`persistedRead()` loops with
  `Bun.sleep` deadlines, used where an awaitable signal exists.
- **Missing tests.** 3,921 churned modules in 90 days have no covering spec; the long tail is
  churn-1 UI leaves, so the table below ranks by churn × blast radius instead. The five that matter
  are composition roots — `apps/serve/src/compose-serve.ts`, `packages/harness/src/tools/register-tools.ts`,
  `packages/harness/src/composition/turn-wiring.ts`, `apps/tui/src/composition/overlay-stack.tsx`,
  `apps/serve/src/serve-boot-finish.ts` — where a regression silently deguts a session rather than
  failing loudly.
- **Convention drift.** Effectively none: zero `.test.ts(x)`, zero cross-package internal imports,
  zero Vitest leakage outside `evals/`. 410 specs sit outside `__tests__/` and 409 of those are
  sanctioned by `apps/api/AGENTS.md`; the single real offender was deleted today. 212 specs exceed
  the 300-line file rule, largest `packages/client/src/channel/__tests__/remote-delta-channel.spec.ts`
  (976 lines) — a readability backlog, not a correctness one.

### Measurements

| subject         | files | tests | wall clock                              |
| --------------- | ----- | ----- | --------------------------------------- |
| `packages/core` | 336   | 3,537 | 86s idle, 103s with four audits running |

Slowest individual tests measured in `packages/harness`, and what each one is paying for:

| test                                                                             | time     | the cost                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/plugin-types/__tests__/drift.spec.ts:6` "match what the generator produces" | 15.0s    | runs the plugin-type generator and compares output — the point of the test                                                                                                                                                                                                                                                                                                         |
| `src/cloud/__tests__/sandbox-client.spec.ts:197` "rejects a wedged connection"   | 10.0s    | waits out a real hung-connection timeout — the point of the test                                                                                                                                                                                                                                                                                                                   |
| `src/execution/__tests__/local-process.spec.ts:81` SIGKILL after grace           | 5.0s     | a real SIGTERM grace period; a candidate for an injected clock                                                                                                                                                                                                                                                                                                                     |
| plugin-type fixture typecheck                                                    | 4.8s     | `tsc` over a materialised fixture — the point of the test                                                                                                                                                                                                                                                                                                                          |
| `src/cloud/__tests__/*` "cloud is answering badly" cluster                       | ~2s each | **not** a fetch timeout: the stub throws synchronously (`account-store-proxy.spec.ts:190-197`), so the time is spent before the call — `signIn`/`seedLocal` writing the encrypted vault per test. Hypothesis to confirm before optimising: a per-test key derivation. If so, cache the derived key rather than lowering the KDF cost, so the tests keep exercising the real vault. |

No test in the run took between 500 ms and 1 s: the distribution is milliseconds or seconds, which
is what a suite with a clear unit/integration split looks like.

### Fixed today

| change                                                                                   | why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deleted `packages/harness/src/execution/__tests__/serve-priority.spec.ts`                | byte-identical to `packages/sandbox/src/__tests__/serve-priority.spec.ts`, and its subject `packages/harness/src/execution/serve-priority.ts` is only `export * from '@dltech/atlas-sandbox'` — the same four tests ran twice per suite, zero coverage lost                                                                                                                                                                                                                                                                                                       |
| deleted `apps/tui/src/composition/__tests__/app-cloud-birth-preflight.spec.tsx`          | a whole-suite `describe.skip` whose two `it`s had empty bodies; its own comment says the `/container` lift it guarded is gone, replaced by `born-cloud-preflight`                                                                                                                                                                                                                                                                                                                                                                                                 |
| fixed `packages/core/src/__tests__/port-registry.spec.ts` "names every entry it carries" | it asserted `new Set(literal).size === literal.length` — a constant against itself — and silently omitted `ThreadReadCursorPort` (`packages/core/src/ports/registry.ts:79`) while claiming to name every entry. Now the literal is `satisfies Record<RegisteredPortName, true>` plus the file's `Expect<Equal<>>` idiom, so a missed or extra port fails `tsc`. Verified by deleting `ThreadReadCursorPort` from the literal and watching typecheck fail (TS1360).                                                                                                |
| added `packages/harness/src/composition/__tests__/turn-wiring.spec.ts` (9 tests)         | `wireTurn` (`turn-wiring.ts:68`) — the seam every session kind passes through, 47 commits/90d — had no spec. Covers: child-runner deps share the parent's `turn`/`intake`/`activity`/`channel`; `QualityReviewPort` resolves optionally (`turn-wiring.ts:184-186`); spending through the wired ledger is readable back from the container's ledger; the container's hook chain is shared; both tl;dr branches (`turn-wiring.ts:229-234`). Verified non-vacuous by mutation: forcing the tl;dr branch open makes "never asks the tl;dr model without a feed" fail. |

### Ruled out — do not re-investigate

- `apps/api/src/agent/agent-tools/__tests__/*` look like verbatim clones of
  `packages/harness/src/tools/builtin/__tests__/*` (they differ only in `new GlobTool(files)` vs
  `new GlobTool()`). They are **not** dead: `apps/api/src/agent/agent-tools` is a live fork wired
  into production at `apps/api/src/agent/runtime/tools.ts:18-25`, and the differing lines are the
  fork's `files`/`processes` ports. Delete these only if the fork itself is ever collapsed back into
  harness; the fork — not the specs — is the real duplication.
- `packages/harness/src/channel/__tests__/lockstep-stream.spec.ts` has no `expect` but is not dead:
  its `until()` helper throws `never published: …` past a deadline, so it does fail. It is a
  slow/flaky candidate (500 ms polling × 41 deltas), not a delete candidate.
- `apps/daemon/src/__tests__/conformance-bundle.spec.ts:14` `it.skip` is a placeholder for an
  unbuilt `bin/daemon.js`, which the spec guards with `existsSync`. Legit.
- The 13 `adapter.available ? describe : describe.skip` gates under
  `packages/harness/src/shells/__tests__/` are unreachable today (`shellAdapters` is
  `[localShellAdapter]`, `shell-registry-fixture.ts:91`) but they are a deliberate platform seam,
  not rot.

### Backlog

Ordered by value; each entry is one sitting.
1. **`register-tools.ts` — uniqueness + resolution spec**
   (`packages/harness/src/tools/register-tools.ts`, 287 lines, 47 commits/90d, no spec): every
   builtin tool name unique across the two container scopes, and each resolves with no undefined
   port. A duplicate registration currently surfaces only at model-call time.
2. **`compose-serve.ts` — session tool routing** (`apps/serve/src/compose-serve.ts`, 307 lines,
   56 commits/90d, no spec): an unroutable session tool request routes to that session's own tool
   set and not another family's.
3. **Slow: confirm and fix the ~2s vault-setup cluster** (`packages/harness/src/cloud/__tests__/`).
   Time `signIn`/`seedLocal` to confirm the per-test key derivation, then cache the derived key per
   process. Do not lower the KDF work factor — that would stop the tests exercising the real vault.
4. **Slow: replace polling with awaitable observation.** `until()` in
   `packages/harness/src/channel/__tests__/lockstep-stream.spec.ts:82`, `persistedRead` in
   `packages/harness/src/shells/__tests__/shell-registry-release.spec.ts:17` (up to 400 × 25 ms),
   and `footerWithin` in the new `turn-wiring.spec.ts` (2 × ~430 ms for the absence cases).
5. **Duplicates in `apps/*`**: 16 near-identical pairs, the prototype mirror of the web feature
   specs is the largest group — merge each pair to one, keeping the copy nearest the source.
6. **Assertion-free specs**: the 21 dead/tautological specs in `packages/*` and the 11 in
   `apps/*`/`plugins/*` (anchors in the audit reports of this run) — each is either a real assertion
   or a deletion.
7. **Over-300-line specs**: 212 files; split as they are touched, starting with
   `packages/client/src/channel/__tests__/remote-delta-channel.spec.ts` (976).
