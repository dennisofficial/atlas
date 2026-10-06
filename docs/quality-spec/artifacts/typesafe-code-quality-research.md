# TypeSafe research for advisory Code Quality

Goal: answer the design discussion about whole-scope vs changed-hunk review and recurring feedback. No implementation authorized.

## Primary sources read

- https://docs.typesafe.ai/concepts/state.md — state is request-local content, string/object/array; all questions independently evaluate the same state. Structured named fields are recommended.
- https://docs.typesafe.ai/api.md — requests contain state/model/questions; question IDs are not visible to inference. Choice selects one option, probabilities sum to one, confidence is provided. Noul is a probability of yes with no separate confidence. Score evaluates ordered levels.
- https://docs.typesafe.ai/primitives/choice.md — single selection, not independent multi-label detection; add none/other options. Multiple questions can be batched.
- https://docs.typesafe.ai/primitives/noul.md — one atomic proposition per question; thresholds belong in code; probability is not severity.
- https://docs.typesafe.ai/patterns/fan-out.md — batch independent/speculative questions and filter their answers in code; vendor says additional questions usually have little response-time impact, not an Atlas latency guarantee.
- https://docs.typesafe.ai/confidence.md — confidence is derived from probability distribution, not additional proof; validate thresholds on domain data.
- https://docs.typesafe.ai/concepts/system-one.md — typed decisions, not generated explanations; calibration does not guarantee individual correctness.
- https://docs.typesafe.ai/model-jaggedness/jev-1.13.md — version-specific caveats: indirection, irrelevant large state, literal reading, adversarial state, choice ordering, not a text generator. Last reviewed 2026-10-02.

## Repository evidence

- packages/core/src/ports/decision.port.ts:1-22 accepts string state/instructions, string choice descriptions; DecisionAnswer does not expose documented confidence. The generic API supports more structure than this current adapter contract.
- packages/core/src/policy/classifier/jev.ts:79-91 response schema needs inspection/update before confidence can be preserved. Read excerpt confirmed probability fields and no exposed confidence in DecisionAnswer.

## Recommendation, not an approved implementation spec

Capture before contents locally; write successfully; review before scope, after scope and diff in one post-write request. Use atomic per-policy questions, with explicit focus in instructions (IDs alone do not guide the model). Assess current whole-scope concern plus policy impact of the edit. Avoid isolated-hunk SRP judgment and arbitrary whole-file context when enclosing class/function is sufficient.

Independent policy checks avoid interpreting a single Choice over policy names as multi-label detection. A per-policy Choice can classify edit impact (introduced, worsened, improved, resolved, unchanged, uncertain) with disjoint descriptions. A whole-after Noul can provide a companion concern check; inconsistencies are inconclusive, not fresh violations.

More judgments do not prevent feedback loops. Track findings and delivery separately from evaluations. Stable issue identity must not be the current content hash; hashes key evaluation caches. Deliver one advisory per issue episode, update its state silently while unchanged/improving, and re-notify only for distinct evidence or a genuine reintroduction after resolution. Keep review active while suppressing repeated nudges. Do not automatically declare low-confidence oscillations resolved/reintroduced.
