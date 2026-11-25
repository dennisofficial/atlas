# Rule v2: two code-quality policies, tuned on development data

Development data: baseline cases (evidence/cases, 40) plus holdout v1 (evidence/cases-v2, 81 accepted), union per rule. The fresh holdout v2 (evidence/cases-v3) was not read.

Trials: 3. Grid: T_c 0.8/0.85/0.9 x T_i 0.4/0.5/0.6/0.7/0.8. Majority of trials. Generated 2026-11-23T07:17:12.240Z.

## Picks

| rule           | accepted | positives | T_c | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| -------------- | -------- | --------- | --- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| silent-failure | 121      | 40        | 0.8 | 0.4 | 23  | 0   | 17  | 81  | 1         | 0.857       | 0.575  |
| open-closed    | 121      | 45        | 0.9 | 0.5 | 37  | 0   | 8   | 76  | 1         | 0.906       | 0.822  |

silent-failure next: T_c 0.8/T_i 0.5 (precision 1, lower 0.857, recall 0.575); T_c 0.85/T_i 0.4 (precision 1, lower 0.839, recall 0.5)

open-closed next: T_c 0.9/T_i 0.6 (precision 1, lower 0.906, recall 0.822); T_c 0.85/T_i 0.5 (precision 1, lower 0.906, recall 0.822)


### silent-failure: all

| T_c  | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| ---- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.8  | 0.4 | 23  | 0   | 17  | 81  | 1         | 0.857       | 0.575  |
| 0.8  | 0.5 | 23  | 0   | 17  | 81  | 1         | 0.857       | 0.575  |
| 0.8  | 0.6 | 20  | 0   | 20  | 81  | 1         | 0.839       | 0.5    |
| 0.8  | 0.7 | 20  | 0   | 20  | 81  | 1         | 0.839       | 0.5    |
| 0.8  | 0.8 | 16  | 0   | 24  | 81  | 1         | 0.806       | 0.4    |
| 0.85 | 0.4 | 20  | 0   | 20  | 81  | 1         | 0.839       | 0.5    |
| 0.85 | 0.5 | 20  | 0   | 20  | 81  | 1         | 0.839       | 0.5    |
| 0.85 | 0.6 | 17  | 0   | 23  | 81  | 1         | 0.816       | 0.425  |
| 0.85 | 0.7 | 17  | 0   | 23  | 81  | 1         | 0.816       | 0.425  |
| 0.85 | 0.8 | 15  | 0   | 25  | 81  | 1         | 0.796       | 0.375  |
| 0.9  | 0.4 | 16  | 0   | 24  | 81  | 1         | 0.806       | 0.4    |
| 0.9  | 0.5 | 16  | 0   | 24  | 81  | 1         | 0.806       | 0.4    |
| 0.9  | 0.6 | 13  | 0   | 27  | 81  | 1         | 0.772       | 0.325  |
| 0.9  | 0.7 | 13  | 0   | 27  | 81  | 1         | 0.772       | 0.325  |
| 0.9  | 0.8 | 11  | 0   | 29  | 81  | 1         | 0.741       | 0.275  |

### silent-failure: synthetic

| T_c  | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| ---- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.8  | 0.4 | 20  | 0   | 11  | 52  | 1         | 0.839       | 0.645  |
| 0.8  | 0.5 | 20  | 0   | 11  | 52  | 1         | 0.839       | 0.645  |
| 0.8  | 0.6 | 17  | 0   | 14  | 52  | 1         | 0.816       | 0.548  |
| 0.8  | 0.7 | 17  | 0   | 14  | 52  | 1         | 0.816       | 0.548  |
| 0.8  | 0.8 | 15  | 0   | 16  | 52  | 1         | 0.796       | 0.484  |
| 0.85 | 0.4 | 19  | 0   | 12  | 52  | 1         | 0.832       | 0.613  |
| 0.85 | 0.5 | 19  | 0   | 12  | 52  | 1         | 0.832       | 0.613  |
| 0.85 | 0.6 | 16  | 0   | 15  | 52  | 1         | 0.806       | 0.516  |
| 0.85 | 0.7 | 16  | 0   | 15  | 52  | 1         | 0.806       | 0.516  |
| 0.85 | 0.8 | 14  | 0   | 17  | 52  | 1         | 0.785       | 0.452  |
| 0.9  | 0.4 | 16  | 0   | 15  | 52  | 1         | 0.806       | 0.516  |
| 0.9  | 0.5 | 16  | 0   | 15  | 52  | 1         | 0.806       | 0.516  |
| 0.9  | 0.6 | 13  | 0   | 18  | 52  | 1         | 0.772       | 0.419  |
| 0.9  | 0.7 | 13  | 0   | 18  | 52  | 1         | 0.772       | 0.419  |
| 0.9  | 0.8 | 11  | 0   | 20  | 52  | 1         | 0.741       | 0.355  |

### silent-failure: repo

| T_c  | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| ---- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.8  | 0.4 | 3   | 0   | 6   | 29  | 1         | 0.438       | 0.333  |
| 0.8  | 0.5 | 3   | 0   | 6   | 29  | 1         | 0.438       | 0.333  |
| 0.8  | 0.6 | 3   | 0   | 6   | 29  | 1         | 0.438       | 0.333  |
| 0.8  | 0.7 | 3   | 0   | 6   | 29  | 1         | 0.438       | 0.333  |
| 0.8  | 0.8 | 1   | 0   | 8   | 29  | 1         | 0.207       | 0.111  |
| 0.85 | 0.4 | 1   | 0   | 8   | 29  | 1         | 0.207       | 0.111  |
| 0.85 | 0.5 | 1   | 0   | 8   | 29  | 1         | 0.207       | 0.111  |
| 0.85 | 0.6 | 1   | 0   | 8   | 29  | 1         | 0.207       | 0.111  |
| 0.85 | 0.7 | 1   | 0   | 8   | 29  | 1         | 0.207       | 0.111  |
| 0.85 | 0.8 | 1   | 0   | 8   | 29  | 1         | 0.207       | 0.111  |
| 0.9  | 0.4 | 0   | 0   | 9   | 29  | null      | null        | 0      |
| 0.9  | 0.5 | 0   | 0   | 9   | 29  | null      | null        | 0      |
| 0.9  | 0.6 | 0   | 0   | 9   | 29  | null      | null        | 0      |
| 0.9  | 0.7 | 0   | 0   | 9   | 29  | null      | null        | 0      |
| 0.9  | 0.8 | 0   | 0   | 9   | 29  | null      | null        | 0      |

### open-closed: all

| T_c  | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| ---- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.8  | 0.4 | 41  | 2   | 4   | 74  | 0.953     | 0.845       | 0.911  |
| 0.8  | 0.5 | 40  | 1   | 5   | 75  | 0.976     | 0.874       | 0.889  |
| 0.8  | 0.6 | 40  | 1   | 5   | 75  | 0.976     | 0.874       | 0.889  |
| 0.8  | 0.7 | 37  | 1   | 8   | 75  | 0.974     | 0.865       | 0.822  |
| 0.8  | 0.8 | 33  | 1   | 12  | 75  | 0.971     | 0.851       | 0.733  |
| 0.85 | 0.4 | 38  | 1   | 7   | 75  | 0.974     | 0.868       | 0.844  |
| 0.85 | 0.5 | 37  | 0   | 8   | 76  | 1         | 0.906       | 0.822  |
| 0.85 | 0.6 | 37  | 0   | 8   | 76  | 1         | 0.906       | 0.822  |
| 0.85 | 0.7 | 34  | 0   | 11  | 76  | 1         | 0.898       | 0.756  |
| 0.85 | 0.8 | 32  | 0   | 13  | 76  | 1         | 0.893       | 0.711  |
| 0.9  | 0.4 | 38  | 1   | 7   | 75  | 0.974     | 0.868       | 0.844  |
| 0.9  | 0.5 | 37  | 0   | 8   | 76  | 1         | 0.906       | 0.822  |
| 0.9  | 0.6 | 37  | 0   | 8   | 76  | 1         | 0.906       | 0.822  |
| 0.9  | 0.7 | 34  | 0   | 11  | 76  | 1         | 0.898       | 0.756  |
| 0.9  | 0.8 | 32  | 0   | 13  | 76  | 1         | 0.893       | 0.711  |

### open-closed: synthetic

| T_c  | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| ---- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.8  | 0.4 | 38  | 0   | 0   | 52  | 1         | 0.908       | 1      |
| 0.8  | 0.5 | 38  | 0   | 0   | 52  | 1         | 0.908       | 1      |
| 0.8  | 0.6 | 38  | 0   | 0   | 52  | 1         | 0.908       | 1      |
| 0.8  | 0.7 | 36  | 0   | 2   | 52  | 1         | 0.904       | 0.947  |
| 0.8  | 0.8 | 33  | 0   | 5   | 52  | 1         | 0.896       | 0.868  |
| 0.85 | 0.4 | 36  | 0   | 2   | 52  | 1         | 0.904       | 0.947  |
| 0.85 | 0.5 | 36  | 0   | 2   | 52  | 1         | 0.904       | 0.947  |
| 0.85 | 0.6 | 36  | 0   | 2   | 52  | 1         | 0.904       | 0.947  |
| 0.85 | 0.7 | 34  | 0   | 4   | 52  | 1         | 0.898       | 0.895  |
| 0.85 | 0.8 | 32  | 0   | 6   | 52  | 1         | 0.893       | 0.842  |
| 0.9  | 0.4 | 36  | 0   | 2   | 52  | 1         | 0.904       | 0.947  |
| 0.9  | 0.5 | 36  | 0   | 2   | 52  | 1         | 0.904       | 0.947  |
| 0.9  | 0.6 | 36  | 0   | 2   | 52  | 1         | 0.904       | 0.947  |
| 0.9  | 0.7 | 34  | 0   | 4   | 52  | 1         | 0.898       | 0.895  |
| 0.9  | 0.8 | 32  | 0   | 6   | 52  | 1         | 0.893       | 0.842  |

### open-closed: repo

| T_c  | T_i | TP  | FP  | FN  | TN  | precision | lower bound | recall |
| ---- | --- | --- | --- | --- | --- | --------- | ----------- | ------ |
| 0.8  | 0.4 | 3   | 2   | 4   | 22  | 0.6       | 0.231       | 0.429  |
| 0.8  | 0.5 | 2   | 1   | 5   | 23  | 0.667     | 0.208       | 0.286  |
| 0.8  | 0.6 | 2   | 1   | 5   | 23  | 0.667     | 0.208       | 0.286  |
| 0.8  | 0.7 | 1   | 1   | 6   | 23  | 0.5       | 0.095       | 0.143  |
| 0.8  | 0.8 | 0   | 1   | 7   | 23  | 0         | 0           | 0      |
| 0.85 | 0.4 | 2   | 1   | 5   | 23  | 0.667     | 0.208       | 0.286  |
| 0.85 | 0.5 | 1   | 0   | 6   | 24  | 1         | 0.207       | 0.143  |
| 0.85 | 0.6 | 1   | 0   | 6   | 24  | 1         | 0.207       | 0.143  |
| 0.85 | 0.7 | 0   | 0   | 7   | 24  | null      | null        | 0      |
| 0.85 | 0.8 | 0   | 0   | 7   | 24  | null      | null        | 0      |
| 0.9  | 0.4 | 2   | 1   | 5   | 23  | 0.667     | 0.208       | 0.286  |
| 0.9  | 0.5 | 1   | 0   | 6   | 24  | 1         | 0.207       | 0.143  |
| 0.9  | 0.6 | 1   | 0   | 6   | 24  | 1         | 0.207       | 0.143  |
| 0.9  | 0.7 | 0   | 0   | 7   | 24  | null      | null        | 0      |
| 0.9  | 0.8 | 0   | 0   | 7   | 24  | null      | null        | 0      |

## Over-bound skip rate (selected scopes over 48 KB)

| rule           | all   | synthetic | repo  | over 24 KB (longest question) |
| -------------- | ----- | --------- | ----- | ----------------------------- |
| silent-failure | 6/420 | 0/285     | 6/135 | 21/420                        |
| open-closed    | 0/525 | 0/357     | 0/168 | 0/525                         |

## Gate selection from the live run (v2 policies)

- silent-failure: by bucket {"positive":"40/40","near-miss":"44/53","negative":"23/28"}; positives dropped none
- open-closed: by bucket {"positive":"44/45","near-miss":"43/50","negative":"19/26"}; positives dropped oc-r003

## Gate selection before and after (all dev cases, deterministic)

| variant                 | positive | near-miss | negative | positives dropped         | negatives selected |
| ----------------------- | -------- | --------- | -------- | ------------------------- | ------------------ |
| sf-v1                   | 40/40    | 48/53     | 23/28    | none                      | 71/81              |
| sf-v2                   | 40/40    | 43/53     | 23/28    | none                      | 66/81              |
| oc-v1                   | 42/45    | 40/50     | 16/26    | oc-r002, oc-r003, oc-r010 | 56/76              |
| oc-v2-file-existed      | 43/45    | 42/50     | 19/26    | oc-r003, oc-r010          | 61/76              |
| oc-v2-bare              | 43/45    | 42/50     | 19/26    | oc-r003, oc-r010          | 61/76              |
| oc-v2-outermost-ternary | 44/45    | 43/50     | 19/26    | oc-r003                   | 62/76              |
| oc-v2-outermost-bare    | 44/45    | 43/50     | 19/26    | oc-r003                   | 62/76              |

## Cost (SRP alone vs shared request)

| shape    | requests | median latency ms | p95 latency ms | median input tokens | over-bound share |
| -------- | -------- | ----------------- | -------------- | ------------------- | ---------------- |
| srp-only | 315      | 135               | 245            | 2709                | 0                |
| srp+both | 315      | 136               | 241            | 4772                | 0.006            |

## Statuses

- silent-failure: {"completed":483}
- open-closed: {"completed":380,"inconclusive":4}

## Why oc-r010 gated out, and the gate change

oc-r010 prepares four scopes: the module, `createRedisLiveFrames` (function, changed), `live` (method, changed) and `publishShellFrame` (function, new). The v1 subject selection returned only `publishShellFrame`: the changed parent function is an ancestor of a subject, so it was dropped, and a method is never a subject. `publishShellFrame`s own diff has no case, else-if, instanceof/typeof or tag compare; the nested ternary on `data.type` sits in the `live` method inside the parent. The line patterns therefore never saw the edit, so the v1 gate never fired, whatever the patterns were.

The v2 gate changes three things:
1. Extension means the FILE existed before: the module scope for the same path has `before !== null`, not `scope.before !== null`.
2. Subject is the outermost changed class or named function: a scope with a reviewable class or named-function ancestor is not a subject, so a nested new function no longer displaces its changed parent.
3. Patterns widened generically: a bare `kind`/`type`/`tag` compare on either side of `===`, and a ternary on a tag (a `?`/`:` line whose own line or next added line compares a tag).

On dev the widening of patterns (variants `oc-v2-bare`, `oc-v2-outermost-ternary`) selected exactly the same cases as the file-existed change plus the outermost subject change; only the subject change gains oc-r010, and the file-existed change alone gains oc-r002. The gate still drops positive oc-r003, whose preparation yields the module scope only (no class or function subject), so the rule is never asked about it.

Gate selection on dev, per bucket: open-closed 42/45 positives and 16/26 negatives selected before; 44/45 and 19/26 after. Silent failure: the test-path exclusion removes 5 synthetic near-miss cases (sf-024, sf-025, sf-076, sf-077, sf-078, all under `src/*/__tests__/`) and no positive; 40/40 positives and 23/28 negatives are selected either way.

---

## SRP no-regression (34 local-creation cases)

Trials: 3. Cases: 34 (34 decided). Generated 2026-11-23T07:17:13.261Z.

| shape                 | impact agreement | currentConcern agreement | evidenceIds agreement | transition agreement |
| --------------------- | ---------------- | ------------------------ | --------------------- | -------------------- |
| SRP alone             | 33/34            | 29/34                    | 34/34                 | 16/34                |
| SRP in shared request | 33/34            | 29/34                    | 34/34                 | 13/34                |

Transition wrong in alone only: recovered-0190fd251d9cc86a7dc13aea51433ad0ca87399a198195fa02fb9770d8373b2a, recovered-0691d181b9f2ec75b12f9edcb2a9fb583012e5363a8a201be8db07d46c11d2a2, recovered-17aab63532ba13820b97da2ec247b8d60b028484de47f91c88f3ae1b4e4327bf, recovered-1bf5fbdeb5d3fc79b543ad2d7c8f00e31e3d8ddf12d1b73edbb8aa34c696666c, recovered-2600674a9005cdb86f6836da8ce47180115505190dee2ae1a6f8cdcc6092db8c, recovered-28b99bcb989a8b22b9e835700c342b9740835c7cc1b733ed506d40b7f775fad3, recovered-78c2e7a215adb6c767385ce54b20910719d74ab2d9d955e4cfbf16bc34bed0df, recovered-816eec9775f71190cec4cb6974dbdf501a38417ebb9dfe42a41b57d6a98d91bf, recovered-8a3526730772c8b9428b07d3518fcaa64192d1f70a00e7787aa3b922511f7605, recovered-9364d0bcc40efd40bec2467def16f9f3b89d77a8c3e86cc582b06f81d60b7465, recovered-b46eb09d5e7240672585c0e0b6c1533681d9f368b0b8c560412e349b0b54be08, recovered-b9c8b3b16708b0f66c4e6bd8216a5b80e5d7ba96fe582870be666112dbf69780, recovered-c500ec821dce8c67cf70496fd1952c2e7e3845a9475e23451dc60a9366af3e29, recovered-c89deb062527512355a2b306df6f06a685bb0919cff53c00aff03c75b5346235, recovered-d55f6d78550bf272e6dcc8530cc48c5846956339e2110ef688aa914a3dc30b9e, recovered-ec5eb1ecf59ffc0fbcee5a0402ee143605d460ad267343ec6e6eb8327ef23dde, recovered-f07ccd6dca7dcfe9ad42e3822a0810c9b7b4f05c5f4f3c45d1b1b8959478e2ed, recovered-f17a66f4c8764b0b76cbe8428580719bccc4a8a135a5fd32205400c17f4b89a6
Transition wrong in shared only: recovered-0190fd251d9cc86a7dc13aea51433ad0ca87399a198195fa02fb9770d8373b2a, recovered-0691d181b9f2ec75b12f9edcb2a9fb583012e5363a8a201be8db07d46c11d2a2, recovered-17aab63532ba13820b97da2ec247b8d60b028484de47f91c88f3ae1b4e4327bf, recovered-1bf5fbdeb5d3fc79b543ad2d7c8f00e31e3d8ddf12d1b73edbb8aa34c696666c, recovered-2600674a9005cdb86f6836da8ce47180115505190dee2ae1a6f8cdcc6092db8c, recovered-28b99bcb989a8b22b9e835700c342b9740835c7cc1b733ed506d40b7f775fad3, recovered-38a37e737d7afcb7ce010fd178aef7b9a88d814c86ff779df62869446945edcf, recovered-78c2e7a215adb6c767385ce54b20910719d74ab2d9d955e4cfbf16bc34bed0df, recovered-79fc85e8299727032cedf39eab33f715cd1b241782d6f07dfbde3bd33bb66447, recovered-816eec9775f71190cec4cb6974dbdf501a38417ebb9dfe42a41b57d6a98d91bf, recovered-8a3526730772c8b9428b07d3518fcaa64192d1f70a00e7787aa3b922511f7605, recovered-9364d0bcc40efd40bec2467def16f9f3b89d77a8c3e86cc582b06f81d60b7465, recovered-b46eb09d5e7240672585c0e0b6c1533681d9f368b0b8c560412e349b0b54be08, recovered-b9c8b3b16708b0f66c4e6bd8216a5b80e5d7ba96fe582870be666112dbf69780, recovered-c500ec821dce8c67cf70496fd1952c2e7e3845a9475e23451dc60a9366af3e29, recovered-c89deb062527512355a2b306df6f06a685bb0919cff53c00aff03c75b5346235, recovered-d55f6d78550bf272e6dcc8530cc48c5846956339e2110ef688aa914a3dc30b9e, recovered-ec5eb1ecf59ffc0fbcee5a0402ee143605d460ad267343ec6e6eb8327ef23dde, recovered-f07ccd6dca7dcfe9ad42e3822a0810c9b7b4f05c5f4f3c45d1b1b8959478e2ed, recovered-f17a66f4c8764b0b76cbe8428580719bccc4a8a135a5fd32205400c17f4b89a6, recovered-f56aba8c171e5b0e04e2550f77848b3a82e9d08c9b24f61c4a2e22b674a0616b

Only SRP alone right (transition): recovered-38a37e737d7afcb7ce010fd178aef7b9a88d814c86ff779df62869446945edcf, recovered-79fc85e8299727032cedf39eab33f715cd1b241782d6f07dfbde3bd33bb66447, recovered-f56aba8c171e5b0e04e2550f77848b3a82e9d08c9b24f61c4a2e22b674a0616b
Only SRP in shared right (transition): none

Transition flips (alone vs shared): recovered-38a37e737d7afcb7ce010fd178aef7b9a88d814c86ff779df62869446945edcf resolve -> none; recovered-79fc85e8299727032cedf39eab33f715cd1b241782d6f07dfbde3bd33bb66447 resolve -> none; recovered-f56aba8c171e5b0e04e2550f77848b3a82e9d08c9b24f61c4a2e22b674a0616b resolve -> none

| shape      | requests | errors | median latency ms | p95 latency ms | median input tokens | median request bytes |
| ---------- | -------- | ------ | ----------------- | -------------- | ------------------- | -------------------- |
| srp-alone  | 102      | 0      | 121.5             | 221            | 2732.5              | 11184                |
| srp-shared | 102      | 0      | 144.5             | 228            | 6608.5              | 28158                |
