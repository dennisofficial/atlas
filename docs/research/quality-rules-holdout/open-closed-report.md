# Quality-rule probe report

Mode: **live**. Status: **scored**. Trials: 3. Generated 2026-11-23T07:07:55.000Z.

## Headline (default thresholds, majority of trials)

| rule        | variant | accepted | positives | TP  | FP  | FN  | TN  | precision | recall | trial agreement |
| ----------- | ------- | -------- | --------- | --- | --- | --- | --- | --------- | ------ | --------------- |
| open-closed | default | 81       | 31        | 20  | 1   | 11  | 49  | 0.952     | 0.645  | 0.975           |
| open-closed | file    | 81       | 31        | 19  | 0   | 12  | 50  | 1         | 0.613  | 0.975           |

## Threshold sweep (T_c = T_i)

### open-closed / default

| T    | TP  | FP  | FN  | TN  | precision | recall |
| ---- | --- | --- | --- | --- | --------- | ------ |
| 0.5  | 26  | 2   | 5   | 48  | 0.929     | 0.839  |
| 0.6  | 25  | 1   | 6   | 49  | 0.962     | 0.806  |
| 0.7  | 23  | 1   | 8   | 49  | 0.958     | 0.742  |
| 0.8  | 20  | 1   | 11  | 49  | 0.952     | 0.645  |
| 0.85 | 16  | 0   | 15  | 50  | 1         | 0.516  |
| 0.9  | 10  | 0   | 21  | 50  | 1         | 0.323  |
| 0.95 | 1   | 0   | 30  | 50  | 1         | 0.032  |

False positives by bucket: {"near-miss":1} (oc-r020)
False negatives: oc-r002, oc-r003, oc-r005, oc-r006, oc-r010, oc-r014, oc-r026, oc-045, oc-046, oc-051, oc-060
Gate (+/- lines): 28 positives selected, 3 dropped (oc-r002, oc-r003, oc-r010). Selected share by bucket: {"positive":"36/41","near-miss":"31/34","negative":"11/16"}.
Gate (+ lines only): 28 positives selected, 3 dropped (oc-r002, oc-r003, oc-r010). Selected share by bucket: {"positive":"36/41","near-miss":"28/34","negative":"11/16"}.
Statuses: {"completed":244,"inconclusive":5}

### open-closed / file

| T    | TP  | FP  | FN  | TN  | precision | recall |
| ---- | --- | --- | --- | --- | --------- | ------ |
| 0.5  | 25  | 2   | 6   | 48  | 0.926     | 0.806  |
| 0.6  | 25  | 1   | 6   | 49  | 0.962     | 0.806  |
| 0.7  | 22  | 0   | 9   | 50  | 1         | 0.71   |
| 0.8  | 19  | 0   | 12  | 50  | 1         | 0.613  |
| 0.85 | 13  | 0   | 18  | 50  | 1         | 0.419  |
| 0.9  | 9   | 0   | 22  | 50  | 1         | 0.29   |
| 0.95 | 0   | 0   | 31  | 50  | n/a       | 0      |

False positives by bucket: {}
False negatives: oc-r002, oc-r003, oc-r005, oc-r006, oc-r010, oc-r014, oc-r026, oc-045, oc-046, oc-051, oc-060, oc-061
Gate (+/- lines): 28 positives selected, 3 dropped (oc-r002, oc-r003, oc-r010). Selected share by bucket: {"positive":"36/41","near-miss":"31/34","negative":"11/16"}.
Gate (+ lines only): 28 positives selected, 3 dropped (oc-r002, oc-r003, oc-r010). Selected share by bucket: {"positive":"36/41","near-miss":"28/34","negative":"11/16"}.
Statuses: {"completed":247,"inconclusive":2}

## Cost

| shape    | requests | median latency ms | p95 latency ms | median input tokens | median state bytes | oversize share |
| -------- | -------- | ----------------- | -------------- | ------------------- | ------------------ | -------------- |
| srp-only | 138      | 142               | 225            | 2717.5              | 2971               | 0              |
| srp+both | 138      | 143.5             | 237            | 5874                | 5251               | 0              |

## Trials

- trial 1: 998 rows, 540 requests, 0 errors
- trial 2: 722 rows, 540 requests, 0 errors
- trial 3: 722 rows, 540 requests, 0 errors

Raw rows: `(session only)`. Labels read from `(session only)`.
