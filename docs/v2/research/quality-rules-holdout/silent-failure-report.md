# Quality-rule probe report

Mode: **live**. Status: **scored**. Trials: 3. Generated 2026-11-23T07:12:01.896Z.

## Headline (default thresholds, majority of trials)

| rule           | variant | accepted | positives | TP  | FP  | FN  | TN  | precision | recall | trial agreement |
| -------------- | ------- | -------- | --------- | --- | --- | --- | --- | --------- | ------ | --------------- |
| silent-failure | default | 81       | 26        | 8   | 2   | 18  | 53  | 0.8       | 0.308  | 0.988           |

## Threshold sweep (T_c = T_i)

### silent-failure / default

| T    | TP  | FP  | FN  | TN  | precision | recall |
| ---- | --- | --- | --- | --- | --------- | ------ |
| 0.5  | 15  | 8   | 11  | 47  | 0.652     | 0.577  |
| 0.6  | 10  | 6   | 16  | 49  | 0.625     | 0.385  |
| 0.7  | 10  | 4   | 16  | 51  | 0.714     | 0.385  |
| 0.8  | 8   | 2   | 18  | 53  | 0.8       | 0.308  |
| 0.85 | 6   | 1   | 20  | 54  | 0.857     | 0.231  |
| 0.9  | 4   | 1   | 22  | 54  | 0.8       | 0.154  |
| 0.95 | 4   | 1   | 22  | 54  | 0.8       | 0.154  |

False positives by bucket: {"near-miss":2} (sf-076, sf-077)
False negatives: sf-r001, sf-r003, sf-r004, sf-r006, sf-r007, sf-r009, sf-r013, sf-046, sf-047, sf-049, sf-051, sf-054, sf-055, sf-056, sf-058, sf-059, sf-060, sf-062
Gate (+/- lines): 26 positives selected, 0 dropped. Selected share by bucket: {"positive":"35/38","near-miss":"34/38","negative":"15/18"}.
Gate (+ lines only): 26 positives selected, 0 dropped. Selected share by bucket: {"positive":"35/38","near-miss":"33/38","negative":"15/18"}.
Statuses: {"completed":249,"rejected":36}

## Cost

| shape    | requests | median latency ms | p95 latency ms | median input tokens | median state bytes | oversize share |
| -------- | -------- | ----------------- | -------------- | ------------------- | ------------------ | -------------- |
| srp-only | 99       | 133               | 249            | 2981                | 3635               | 0.04           |
| srp+both | 99       | 145               | 243            | 7204                | 5915               | 0.091          |

## Trials

- trial 1: 509 rows, 189 requests, 0 errors
- trial 2: 311 rows, 189 requests, 0 errors
- trial 3: 311 rows, 189 requests, 0 errors

Raw rows: `(session only)`. Labels read from `(session only)`.
