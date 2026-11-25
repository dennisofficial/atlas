# Quality-rule probe report

Mode: **live**. Status: **scored**. Trials: 3. Generated 2026-11-23T06:31:32.955Z.

## Headline (default thresholds, majority of trials)

| rule           | variant | accepted | positives | TP  | FP  | FN  | TN  | precision | recall | trial agreement |
| -------------- | ------- | -------- | --------- | --- | --- | --- | --- | --------- | ------ | --------------- |
| silent-failure | default | 40       | 14        | 9   | 0   | 5   | 26  | 1         | 0.643  | 0.975           |
| open-closed    | default | 40       | 14        | 11  | 0   | 3   | 26  | 1         | 0.786  | 0.975           |
| open-closed    | file    | 40       | 14        | 12  | 0   | 2   | 26  | 1         | 0.857  | 0.95            |

## Threshold sweep (T_c = T_i)

### silent-failure / default

| T    | TP  | FP  | FN  | TN  | precision | recall |
| ---- | --- | --- | --- | --- | --------- | ------ |
| 0.5  | 13  | 0   | 1   | 26  | 1         | 0.929  |
| 0.6  | 12  | 0   | 2   | 26  | 1         | 0.857  |
| 0.7  | 11  | 0   | 3   | 26  | 1         | 0.786  |
| 0.8  | 9   | 0   | 5   | 26  | 1         | 0.643  |
| 0.85 | 9   | 0   | 5   | 26  | 1         | 0.643  |
| 0.9  | 7   | 0   | 7   | 26  | 1         | 0.5    |
| 0.95 | 3   | 0   | 11  | 26  | 1         | 0.214  |

False positives by bucket: {}
False negatives: sf-003, sf-004, sf-005, sf-006, sf-011
Gate (+/- lines): 14 positives selected, 0 dropped. Selected share by bucket: {"positive":"14/14","near-miss":"16/16","negative":"8/10"}.
Gate (+ lines only): 14 positives selected, 0 dropped. Selected share by bucket: {"positive":"14/14","near-miss":"16/16","negative":"8/10"}.
Statuses: {"completed":126}

### open-closed / default

| T    | TP  | FP  | FN  | TN  | precision | recall |
| ---- | --- | --- | --- | --- | --------- | ------ |
| 0.5  | 14  | 0   | 0   | 26  | 1         | 1      |
| 0.6  | 14  | 0   | 0   | 26  | 1         | 1      |
| 0.7  | 14  | 0   | 0   | 26  | 1         | 1      |
| 0.8  | 11  | 0   | 3   | 26  | 1         | 0.786  |
| 0.85 | 9   | 0   | 5   | 26  | 1         | 0.643  |
| 0.9  | 5   | 0   | 9   | 26  | 1         | 0.357  |
| 0.95 | 1   | 0   | 13  | 26  | 1         | 0.071  |

False positives by bucket: {}
False negatives: oc-005, oc-006, oc-009
Gate (+/- lines): 14 positives selected, 0 dropped. Selected share by bucket: {"positive":"14/14","near-miss":"14/16","negative":"5/10"}.
Gate (+ lines only): 14 positives selected, 0 dropped. Selected share by bucket: {"positive":"14/14","near-miss":"12/16","negative":"5/10"}.
Statuses: {"completed":102}

### open-closed / file

| T    | TP  | FP  | FN  | TN  | precision | recall |
| ---- | --- | --- | --- | --- | --------- | ------ |
| 0.5  | 14  | 0   | 0   | 26  | 1         | 1      |
| 0.6  | 14  | 0   | 0   | 26  | 1         | 1      |
| 0.7  | 14  | 0   | 0   | 26  | 1         | 1      |
| 0.8  | 12  | 0   | 2   | 26  | 1         | 0.857  |
| 0.85 | 9   | 0   | 5   | 26  | 1         | 0.643  |
| 0.9  | 2   | 0   | 12  | 26  | 1         | 0.143  |
| 0.95 | 0   | 0   | 14  | 26  | n/a       | 0      |

False positives by bucket: {}
False negatives: oc-005, oc-009
Gate (+/- lines): 14 positives selected, 0 dropped. Selected share by bucket: {"positive":"14/14","near-miss":"14/16","negative":"5/10"}.
Gate (+ lines only): 14 positives selected, 0 dropped. Selected share by bucket: {"positive":"14/14","near-miss":"12/16","negative":"5/10"}.
Statuses: {"completed":102}

## Cost

| shape    | requests | median latency ms | p95 latency ms | median input tokens | median state bytes | oversize share |
| -------- | -------- | ----------------- | -------------- | ------------------- | ------------------ | -------------- |
| srp-only | 102      | 130.5             | 234            | 2452.5              | 2112               | 0              |
| srp+both | 102      | 143.5             | 235            | 5507.5              | 4392               | 0              |

## Trials

- trial 1: 611 rows, 287 requests, 0 errors
- trial 2: 407 rows, 287 requests, 0 errors
- trial 3: 407 rows, 287 requests, 0 errors

Raw rows: `(raw rows kept in the session only)`. Labels: the `*.accepted-labels.jsonl` files here.
