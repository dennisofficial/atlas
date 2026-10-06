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
`eval:label-review` accepts them. Changing a verified label creates a new dataset version and reruns BOTH
baseline and candidate.

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
