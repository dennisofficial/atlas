# Rule v2 probe: dev-data tuning

Trials: 3. Grid: T_c 0.8/0.85/0.9 x T_i 0.4/0.5/0.6/0.7/0.8. Majority of trials. Generated 2026-11-23T07:18:35.964Z.

## Picks

| rule           | accepted | positives | T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| -------------- | -------- | --------- | --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| silent-failure | 27       | 8         | 0.8 | 0.4 | 6   | 0   | 2   | 19  | 1         | 0.61        | 0.75   |
| open-closed    | 0        | 0         | 0.9 | 0.5 | 0   | 0   | 0   | 0   | null      | null        | null   |


### silent-failure: all

| T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.8 | 0.4 | 6   | 0   | 2   | 19  | 1         | 0.61        | 0.75   |

### silent-failure: synthetic

| T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.8 | 0.4 | 0   | 0   | 0   | 0   | null      | null        | null   |

### silent-failure: repo

| T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.8 | 0.4 | 6   | 0   | 2   | 19  | 1         | 0.61        | 0.75   |

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
| silent-failure | 6/120 | 0/0       | 6/120 | 9/120                         |
| open-closed    | 0/0   | 0/0       | 0/0   | 0/0                           |

## Gate selection from the live run (v2 policies)

- silent-failure: by bucket {"positive":"8/8","near-miss":"16/19"}; positives dropped none
- open-closed: by bucket {}; positives dropped none

## Gate selection before and after (all dev cases, deterministic)

| variant | positive | near-miss | negative | positives dropped | negatives selected |
| ------- | -------- | --------- | -------- | ----------------- | ------------------ |
| sf-v1   | 8/8      | 16/19     | 0/0      | none              | 16/19              |
| sf-v2   | 8/8      | 16/19     | 0/0      | none              | 16/19              |

## Cost (SRP alone vs shared request)

| shape    | requests | median latency ms | p95 latency ms | median input tokens | over-bound share |
| -------- | -------- | ----------------- | -------------- | ------------------- | ---------------- |
| srp-only | 40       | 131.5             | 204            | 2851                | 0                |
| srp+both | 40       | 145.5             | 241            | 4957                | 0.05             |

## Statuses

- silent-failure: {"completed":90}
- open-closed: {"completed":33}

Raw rows: `(session only)`. Labels: `(session only)`. Gate: `(session only)`.
