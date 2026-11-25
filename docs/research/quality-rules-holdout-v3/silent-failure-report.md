# Rule v2 probe: dev-data tuning

Trials: 3. Grid: T_c 0.8/0.85/0.9 x T_i 0.4/0.5/0.6/0.7/0.8. Majority of trials. Generated 2026-11-23T07:52:34.838Z.

## Picks

| rule           | accepted | positives | T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| -------------- | -------- | --------- | --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| silent-failure | 60       | 24        | 0.8 | 0.4 | 10  | 3   | 14  | 33  | 0.769     | 0.497       | 0.417  |
| open-closed    | 0        | 0         | 0.9 | 0.5 | 0   | 0   | 0   | 0   | null      | null        | null   |


### silent-failure: all

| T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.8 | 0.4 | 10  | 3   | 14  | 33  | 0.769     | 0.497       | 0.417  |

### silent-failure: synthetic

| T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.8 | 0.4 | 0   | 0   | 0   | 0   | null      | null        | null   |

### silent-failure: repo

| T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.8 | 0.4 | 10  | 3   | 14  | 33  | 0.769     | 0.497       | 0.417  |

### open-closed: all

| T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.9 | 0.5 | 0   | 0   | 0   | 0   | null      | null        | null   |

### open-closed: synthetic

| T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.9 | 0.5 | 0   | 0   | 0   | 0   | null      | null        | null   |

### open-closed: repo

| T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.9 | 0.5 | 0   | 0   | 0   | 0   | null      | null        | null   |

## Over-bound skip rate (selected scopes over 48 KB)

| rule           | all   | synthetic | repo  | over 24 KB (longest question) |
| -------------- | ----- | --------- | ----- | ----------------------------- |
| silent-failure | 6/297 | 0/0       | 6/297 | 6/297                         |
| open-closed    | 0/0   | 0/0       | 0/0   | 0/0                           |

## Gate selection from the live run (v2 policies)

- silent-failure: by bucket {"p":"15/15","n":"9/9","g":"8/8","positive":"8/9","near-miss":"11/11","negative":"6/8"}; positives dropped sf-b012
- open-closed: by bucket {}; positives dropped none

## Gate selection before and after (all dev cases, deterministic)

| variant | positive | near-miss | negative | positives dropped | negatives selected |
| ------- | -------- | --------- | -------- | ----------------- | ------------------ |
| sf-v1   | 8/9      | 11/11     | 6/8      | sf-b012           | 34/36              |
| sf-v2   | 8/9      | 11/11     | 6/8      | sf-b012           | 34/36              |

## Cost (SRP alone vs shared request)

| shape    | requests | median latency ms | p95 latency ms | median input tokens | over-bound share |
| -------- | -------- | ----------------- | -------------- | ------------------- | ---------------- |
| srp-only | 99       | 119               | 230            | 2998                | 0                |
| srp+both | 99       | 133               | 234            | 4959                | 0.02             |

## Statuses

- silent-failure: {"completed":235,"inconclusive":5}
- open-closed: {"completed":51}

Raw rows: `(session only)`. Labels: `(session only)`. Gate: `(session only)`.
