# code-quality evals — policy rubric and data details

Read `../AGENTS.md` (evals/) first. It owns the commands, the artifact contract and the integrity rules. This file holds
the code-quality/single-responsibility details.

## Feature

- Feature id: `code-quality/single-responsibility` (registered in `../src/registry-default.ts`).
- Input: a prepared `QualityScope` from the core contract, plus the policy list. A case carries the exact production
  preparation inputs. It never carries a copied prompt.
- Output: the interpreted `QualityAssessment` list, plus the resolved model and the timing. Grading compares only
  the normalized impact / current-concern / evidence-id fields. It never compares prose, durations or episode UUIDs.

## Expected labels

Each case's `expected` is either:
- `{ kind: "decided", fields: { impact, currentConcern, evidenceIds } }` — deterministic tuple comparison, or
- `{ kind: "abstain" }` — the correct behavior is an inconclusive/skipped assessment. The grader counts it as a correct
  abstention, never as decided accuracy.

Labels are drafted offline under the versioned SRP rubric. A separate reviewer verifies them blind before
`eval:label-review` accepts them. When the workflow uses reasoning agents, the reviewer sees only the sanitized
input and the rubric. The reviewer never sees the drafter's judgment or the output of the evaluated model. The
reviewer records the actual identity and model, or records honestly that the agent API exposes no model identity.
The reviewer also records the reasoning, the disagreement and the uncertainty. Such a result is machine-reviewed
evidence. It is never human ground truth, and never independently calibrated model ground truth. Expected evidence
ids are checked against the evidence that the candidate supplied. Changing a verified label creates a new dataset
version, and runs BOTH the baseline and the candidate again.

## SRP rubric (mirrors section 04 thresholds)

- New finding: currentConcern >= 0.8 AND an introduced or worsened impact >= 0.8. An evidence-specific finding also
  needs a supplied focus candidate >= 0.8. Without that candidate the finding is tracked debt, and no nudge is sent.
- Resolution: concern <= 0.2 AND a confident resolved, improved or unchanged verdict (>= 0.8). A band between the two
  never resolves or reopens a finding.
- The policy thresholds live in `packages/core/src/quality/policies/single-responsibility.ts`, which the section 04
  teammate owns. Evals consume those thresholds. A grader never encodes them again.

## Dataset

`../datasets/code-quality/single-responsibility/` holds an empty validated skeleton today. Real cases
come from sanitized exports only. A probe or synthetic case is tagged, and is never counted as real-session volume.
Grouped splits keep the session, repository and change-family groups together. The holdout split is for promotion, not
for tuning.

## Captured-example format and scope fidelity

`eval:export-examples` reads the files that `QualityExampleSink` writes. The sink `schemaVersion` is the STRING `"1"`.
Any other value is rejected. The capture id is the sha256 name of the sink file, checked against the content, the
before and after hashes and the stored diff. Exports and candidates carry the stored SCOPE snapshot: the declaration
text, the diff, the dependency context, the evidence and the per-field redaction maps. Neither carries a reconstructed
full file. No capture timestamp exists to invent. The export schema is the numeric `1`, and the
candidate schema is the numeric `2`. Both are distinct from the sink's string version. The golden input rebuilds the
`QualityScope` from the snapshot after it re-checks the digests, the diff and the evidence-id uniqueness. The pure
production SRP policy is imported directly.

Model parity: a decision that resolves a model other than the one requested is a task execution error. It is
never graded and never promotable. `eval:compare` also requires identical enabled policy ids, batch mode and
resolved model. It exits 1 on a regression, and 2 when the runs are incomparable.

`eval:efficacy` reports impact and the explicitly named `currentConcern>=0.5` classification. It reports the actual
decision coverage and abstentions, the evidence grounding, and the fresh-episode notification from the production
ledger. Before the outputs it also prints a Weka 0-R training-mode yardstick, derived from the frozen judgments.
Accuracy that only matches that mode is not model gain. A one-repository, one-class-family pilot with no
positive or abstention denominators has undefined recall and precision. Such a pilot is insufficient for a holdout or
production enablement claim.
