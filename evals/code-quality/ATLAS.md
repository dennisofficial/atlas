# code-quality evals — policy rubric and data details

Read `../ATLAS.md` (evals/) first; it owns commands, artifact contract and integrity rules. This file holds
the code-quality/single-responsibility specifics.

## Feature

- Feature id: `code-quality/single-responsibility` (registered in `../src/registry-default.ts`).
- Input: a prepared `QualityScope` (core contract) plus the policy list. Cases carry the exact production
  preparation inputs — never a copied prompt.
- Output: the interpreted `QualityAssessment` list plus resolved model and timing. Grading compares only
  normalized impact / current-concern / evidence-id fields — never prose, durations or episode UUIDs.

## Expected labels

Each case's `expected` is either:
- `{ kind: "decided", fields: { impact, currentConcern, evidenceIds } }` — deterministic tuple comparison, or
- `{ kind: "abstain" }` — the correct behavior is an inconclusive/skipped assessment; graded as correct
  abstention, never counted as decided accuracy.

Labels are drafted offline under the versioned SRP rubric and verified blind by a separate reviewer before
`eval:label-review` accepts them. When the workflow uses reasoning agents, the reviewer sees only sanitized
input plus rubric — never the drafter's judgment or the evaluated model's output — and records actual
identity/model (or honestly records that the agent API exposes no model identity), reasoning, disagreement
and uncertainty. Such results are machine-reviewed evidence, never human or independently calibrated model
ground truth. Expected evidence ids are validated against the candidate's supplied evidence. Changing a
verified label creates a new dataset version and reruns BOTH baseline and candidate.

## SRP rubric (mirrors section 04 thresholds)

- New finding: currentConcern >= 0.8 AND introduced/worsened impact >= 0.8; evidence-specific finding also
  needs a supplied focus candidate >= 0.8 (else tracked debt, no nudge).
- Resolution: concern <= 0.2 AND confident resolved/improved/unchanged (>= 0.8). Bands between never
  resolve/reopen.
- The policy thresholds live in `packages/core/src/quality/policies/single-responsibility.ts` (section 04
  teammate); evals consume them, they never re-encode them in graders.

## Dataset

`../datasets/code-quality/single-responsibility/` currently holds an empty validated skeleton. Real cases
come from sanitized exports only; probe/synthetic cases are tagged and never counted as real-session volume.
Grouped splits keep session/repository/change-family groups together; holdout is for promotion, not tuning.

## Captured-example format and scope fidelity

`eval:export-examples` reads the files `QualityExampleSink` writes (sink `schemaVersion` is the STRING `"1"`;
anything else is rejected). The capture id is the sink file's sha256 name, verified against the content, the
before/after hashes and the stored diff. Exports and candidates carry the stored SCOPE snapshot (declaration
text, diff, dependency context, evidence, per-field redaction maps), never a reconstructed full file, and no
capture timestamp exists to invent. Export schema is numeric `1`, candidate schema numeric `2`; they are
distinct from the sink's string version. The golden input rebuilds the `QualityScope` from the snapshot after
re-checking digests, diff and evidence-id uniqueness; the pure production SRP policy is imported directly.

Model parity: a decision that resolves a model other than the one requested is a task execution error
(never graded, never promotable). `eval:compare` also requires identical enabled policy ids, batch mode and
resolved model, and exits 1 on regression, 2 when incomparable.

`eval:efficacy` separately reports impact, explicitly named `currentConcern>=0.5` classification, actual
decision coverage/abstentions, evidence grounding, and fresh-episode notification from the production
ledger. It also prints a Weka 0-R training-mode yardstick derived from frozen judgments before outputs;
accuracy that merely matches that mode is not model gain. A one-repository/one-class-family pilot with no
positive or abstention denominators has undefined recall/precision and is insufficient for holdout or
production enablement claims.
