# Rule v2 probe: dev-data tuning

Trials: 3. Grid: T_c 0.8/0.85/0.9 x T_i 0.4/0.5/0.6/0.7/0.8. Majority of trials. Generated 2026-11-23T07:42:00.299Z.

## Picks

| rule           | accepted | positives | T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| -------------- | -------- | --------- | --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| silent-failure | 0        | 0         | 0.8 | 0.4 | 0   | 0   | 0   | 0   | null      | null        | null   |
| open-closed    | 32       | 1         | 0.9 | 0.5 | 1   | 0   | 0   | 31  | 1         | 0.207       | 1      |


### silent-failure: all

| T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.8 | 0.4 | 0   | 0   | 0   | 0   | null      | null        | null   |

### silent-failure: synthetic

| T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.8 | 0.4 | 0   | 0   | 0   | 0   | null      | null        | null   |

### silent-failure: repo

| T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.8 | 0.4 | 0   | 0   | 0   | 0   | null      | null        | null   |

### open-closed: all

| T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.9 | 0.5 | 1   | 0   | 0   | 31  | 1         | 0.207       | 1      |

### open-closed: synthetic

| T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.9 | 0.5 | 0   | 0   | 0   | 0   | null      | null        | null   |

### open-closed: repo

| T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.9 | 0.5 | 1   | 0   | 0   | 31  | 1         | 0.207       | 1      |

## Over-bound skip rate (selected scopes over 48 KB)

| rule           | all   | synthetic | repo  | over 24 KB (longest question) |
| -------------- | ----- | --------- | ----- | ----------------------------- |
| silent-failure | 0/0   | 0/0       | 0/0   | 0/0                           |
| open-closed    | 6/201 | 0/0       | 6/201 | 6/201                         |

## Gate selection from the live run (v2 policies)

- silent-failure: by bucket {}; positives dropped none
- open-closed: by bucket {"positive":"1/1","near-miss":"13/13","negative":"9/18"}; positives dropped none

## Gate selection before and after (all dev cases, deterministic)

| variant                 | positive | near-miss | negative | positives dropped | negatives selected |
| ----------------------- | -------- | --------- | -------- | ----------------- | ------------------ |
| oc-v1                   | 1/1      | 11/13     | 7/18     | none              | 18/31              |
| oc-v2-file-existed      | 1/1      | 13/13     | 9/18     | none              | 22/31              |
| oc-v2-bare              | 1/1      | 13/13     | 9/18     | none              | 22/31              |
| oc-v2-outermost-ternary | 1/1      | 13/13     | 9/18     | none              | 22/31              |
| oc-v2-outermost-bare    | 1/1      | 13/13     | 9/18     | none              | 22/31              |

## Cost (SRP alone vs shared request)

| shape    | requests | median latency ms | p95 latency ms | median input tokens | over-bound share |
| -------- | -------- | ----------------- | -------------- | ------------------- | ---------------- |
| srp-only | 67       | 139               | 223            | 2932                | 0                |
| srp+both | 67       | 133               | 257            | 4668                | 0.03             |

## Statuses

- silent-failure: {"completed":99}
- open-closed: {"completed":78}

Raw rows: `(session only)`. Labels: `(session only)`. Gate: `(session only)`.
