# Silent-failure holdout — findings (2026-11-23, gateway/typesafe-ai/jev, 3 trials, majority)

Holdout: 94 cases (44 real, 50 synthetic), 81 accepted, 13 quarantined. Accepted: 26 notify true, 55 false.

| T=0.8 (spec default) | TP  | FP  | FN  | TN  | precision | recall |
| -------------------- | --- | --- | --- | --- | --------- | ------ |
| all                  | 8   | 2   | 18  | 53  | 0.80      | 0.31   |
| synthetic            | 6   | 2   | 11  | 24  | 0.75      | 0.35   |
| real                 | 2   | 0   | 7   | 29  | 1.00      | 0.22   |

At T=0.7: 10/4/16/51 (0.71 / 0.38). Fails the ship bar at every threshold.

## Why

- Both FPs are test helpers (sf-076, sf-077, paths under `__tests__/*.spec.ts`): Jev is confident (0.84–0.98) and ignores the
  test-code exception. A deterministic path rule fixes this, no classifier judgment needed.
- Misses: concern is high (0.78–0.97) on most positives, but impact confidence is low (0.32–0.78) or impact is
  `improved` (4 cases: a log was added to a failure, which Jev reads as better). Same pattern as open/closed.
- 6 real cases (sf-r005, r006, r013, r025, r030, r044) exceeded the 48 KB shared-request bound; 2 positives lost.
  The three-policy request is 7.2k median input tokens here (SRP alone 3.0k).
- Labels disagree on two rubric edges (13 quarantined): a log added to a formerly silent failure (new hidden failure
  or improvement?) and a `.catch` on an unawaited promise (out of scope per Dennis).

## Exploratory only (tuned ON holdout — not a promotion result)

Test-path exclusion + T_concern=0.85, T_impact=0.4: 14/0/12/55 (precision 1.00, recall 0.54).
