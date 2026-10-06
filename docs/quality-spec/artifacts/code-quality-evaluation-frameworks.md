# Evaluation-framework investigation

Design discussion only. No project changes, dependency installs, or live model executions.

## Dennis's framework

Audited current main commit 115f22b675f025664a789e791ce4115027cd3f40, package @dltech/ai-testing 1.2.1.

- src/types.ts:56-70: RunnableLike is structural invoke(input, config?) with optional withConfig. Framework/model-agnostic execution is real; README overstates LangChain runnable requirement.
- src/runner/run-module.ts:69-107: runner calls invoke(input); callbacks attach only when configured and withConfig exists. No runner-supplied abort signal. Jev adapter must provide cancellation and turn operational DecisionOutcome faults into errors.
- package.json:31-92: Node >=20, required @langchain/core peer, openevals/agentevals/Ink/React/tsx/SWC direct dependencies. Package not dependency-agnostic. LangChain imports in core types/runner are type-only, so do not claim LangChain chains are mandatory.
- src/runner/run-module.ts:128-173: per-emitted-metric means, clamped [0,1] grades; invocation errors cause failure but are not scored. No dataset-level classification reducers, per-request latency, or native repeats here.
- Agent checked CLI/public exports: no supported machine-readable result export or persisted run comparison. Skips can remove metrics without coverage gates. Main verified actual types, runner, manifest through pinned raw GitHub sources.

Recommendation: reuse candidate with ordinary Jev invoke adapter; keep evaluator toolchain development-only and separate from runtime policies. For durable eval foundation, add/export results, classify errors/skips/coverage, record per-request timing/model/policy versions, and support dataset-level metrics. Do not create another bespoke runner by default.

Sources:
https://github.com/dennisofficial/langchain-testing-framework/blob/115f22b675f025664a789e791ce4115027cd3f40/src/types.ts#L56-L70
https://github.com/dennisofficial/langchain-testing-framework/blob/115f22b675f025664a789e791ce4115027cd3f40/src/runner/run-module.ts#L69-L173
https://github.com/dennisofficial/langchain-testing-framework/blob/115f22b675f025664a789e791ce4115027cd3f40/package.json#L31-L92

## Alternatives read from primary docs

Evalite: plain data/task/scorers TypeScript contract, local SQLite reports, optional local UI, JSON and static HTML export, variant comparisons. Stable documentation advertises v1 beta separately; do not mix versions. Vitest-based, better-sqlite3/native dependency and Node-oriented stack require compatibility smoke test, especially with Atlas's Bun runtime and AI SDK 7. No integration validated.
https://www.evalite.dev/quickstart/
https://www.evalite.dev/guides/scorers/
https://www.evalite.dev/guides/ci/
https://www.evalite.dev/guides/variant-comparison/

Braintrust: data/task/scores and trials, but documented local execution creates cloud experiments. Less direct match for local-first requirement; not recommended as initial foundation.
https://www.braintrust.dev/docs/evaluate/run-in-code

## Evaluation design needs

Per-policy versioned golden cases (introduced/worsened/unchanged/improved/resolved/ambiguous), known-valid counterexamples, multi-policy cases, injected source comments, changed option orders and repeat trials. Prefer deterministic label comparison for bounded Jev outputs, not model judges as default. Record precision/recall, false-positive rate, abstention coverage, calibration, operational errors, and end-to-end p50/p95 latency. Use holdout cases.

Bun unit/integration tests verify pure finding lifecycle and successive edit sequences independently of live model efficacy. Live opt-in evals exercise the exact production context preparation/questions/answer interpretation via DecisionPort. Never give expected labels to the model under test. No eval framework dependency in core/runtime or shipped binary.
