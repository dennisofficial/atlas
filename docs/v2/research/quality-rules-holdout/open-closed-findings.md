# Open/closed holdout — findings (2026-11-23, gateway/typesafe-ai/jev, 3 trials, majority)

Holdout: 91 cases (41 real, 50 synthetic), 81 accepted, 10 quarantined (all real, all blind=false vs draft=true).
Accepted: synthetic 24 pos / 26 neg; real 7 pos / 24 neg.

| T=0.8 (spec default) | TP  | FP  | FN  | TN  | precision | recall |
| -------------------- | --- | --- | --- | --- | --------- | ------ |
| all                  | 20  | 1   | 11  | 49  | 0.952     | 0.645  |
| synthetic            | 20  | 0   | 4   | 26  | 1.00      | 0.83   |
| real                 | 0   | 1   | 7   | 23  | 0.00      | 0.00   |

Whole-file variant at 0.8: 19/0/12/50 (precision 1.00, recall 0.61) — no gain.

## Ship bar (§5.3): FAILS

- precision 0.952 meets ≥0.95, but 1 FP in 21 → 95% lower bound ≈ 0.77 < 0.85.
- On real code it finds nothing: 0 of 7 real positives at 0.8; 1 of 7 at 0.7.
- The one FP is oc-r020 (prisma hover.ts, the drafter's own "most arguable" near-miss; AST over schema symbol kinds).

## Why real positives are missed

- Gate drops 3 of 7 real positives before Jev sees them:
  - oc-r002: the chain sits in a NEW function inside an edited file → scope.before is null → gate requires before !== null.
  - oc-r003: switch at module level of a bin script → no class or named-function subject is selected at all.
  - oc-r010: dispatch written as a nested ternary on `data.type` → no gate regex matches ternaries.
- The other 4 reach Jev with high concern (0.82–0.94) but low impact confidence (0.47–0.75), or impact `unchanged` (oc-r005 large class AppCursor, concern 0.90, impact unchanged 0.71).

## Exploratory only (tuned ON holdout — not a promotion result)

Split thresholds T_concern=0.85, T_impact=0.4: all 26/0/5, real 2/0/5. Any split chosen here needs a fresh holdout.
