# Spec: two more Jev quality rules — silent failure and open/closed

> **Dropped by Dennis 2026-11-23.** Neither rule is built. Measured on real code, silent failure
> reached precision 0.84 against the 0.95 bar, blind labellers agreed on only 67–72% of real
> cases, and open/closed almost never fires on real code (1 positive in 32 accepted cases). See §7.

Status: **dropped**, 2026-11-23. The design (§4) and the evals (§5) stay as the record. Owner would have been the quality plugin (`plugins/quality`, after the plugin move
lands). Anchors read at `729f35521`. Builds on `jev-quality.md` (the review) and `classifier.md`
(the port).

Both rules are general coding rules. No question, definition, exception or nudge names Atlas, its
packages or its conventions.

---

## 1. Product contract

- Two new policies sit beside single responsibility: **silent failure** (an error or failed outcome
  is hidden from the caller) and **open/closed** (an edit extends behaviour by growing a conditional
  on a type tag, where a new type, handler or table entry should do it).
- Each policy has its own switch, `quality.policies.silentFailure` and `quality.policies.openClosed`.
  A policy ships only when its eval passes the bar in §5.3, and a shipped policy is on by default.
- Same contract as single responsibility: advisory, one note for one step, a finding notifies once
  per episode, a write never fails because of a review.
- No new event, frame or surface. The TUI and web indicators already name the policy title.

---

## 2. What a review sees today

The request state is `scope.{before, after, diff, dependencyContext, evidence}` plus each enabled
policy's `{id, definition, exceptions}` (`packages/core/src/quality/request.ts:46-66`).

| Field               | Content                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `before`, `after`   | complete text of the subject declaration: the outermost changed class, else a changed named top-level function (`single-responsibility.ts:94-126`) |
| `diff`              | unified diff of that declaration                                                                                                                   |
| `dependencyContext` | the file's import statements (`plugins/quality/src/review/source/scope-adapter.ts:178`)                                                            |
| `evidence`          | member labels of a class (`scope-adapter.ts:118-143`); none for a function                                                                         |

Not in the state: the rest of the file, the definitions of imported types, the callers, and any
type information. Every policy that selects a scope shares one classifier request
(`plugins/quality/src/review/review-scopes.ts:177-197`), so three rules on one scope cost one call.

---

## 3. What each rule needs, and who judges it

### 3.1 Silent failure

| Shape                                                                           | Needs                               | Owner                                                               |
| ------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| empty `catch`                                                                   | syntax only                         | Biome `suspicious/noEmptyBlockStatements` (recommended, on as warn) |
| a promise nobody awaits or handles                                              | the callee's return type            | nobody: out of scope (§9)                                           |
| log-only `catch` that continues as if it succeeded                              | the scope                           | Jev                                                                 |
| `catch` or `.catch` that returns a normal-looking value (`[]`, `null`, default) | the scope, the function's contract  | Jev                                                                 |
| fallback (`??`, `\|\|`) that hides a failed operation                           | the scope                           | Jev                                                                 |
| a returned failure object or `allSettled` result that is ignored                | the scope; the callee's shape helps | Jev, partly                                                         |

A classifier cannot tell `save(x);` from `log(x);` without the callee's type, so it cannot judge an
unawaited promise reliably. Giving it types would make every request bigger, and the review runs on
every file write. Dennis decided (2026-11-23) to drop the shape: no Jev question and no Biome
`nursery/noFloatingPromises`. Jev judges only what the scope and the diff show: whether a
handled-looking failure is really handled, and whether a fallback is an expected absence or a hidden
fault.

### 3.2 Open/closed

The finding is about **the edit**: a new case or branch added to a dispatch chain. The scope plus the
diff shows that. What the scope does not show is whether this chain is the single designated
composition point (a registry, a parser over a closed grammar). The type definition and the
other dispatch sites are not needed to see the edit. The baseline (§5) measured a `scope.file`
variant that adds the whole file: precision is the same, recall rises by one case at 0.8 and is
equal at 0.7. That does not pay for about 2 KB more per request, so the state stays as it is.


### 3.3 Answer

| Rule           | Can Jev judge it?                                                                                                                               | Context                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Silent failure | **Partly.** Yes for swallowing catches, hiding fallbacks and ignored failure values. No for unawaited promises, which need types: out of scope. | the scope and the diff, as today                |
| Open/closed    | **Yes**, judged on the edit.                                                                                                                    | the scope and the diff, as today; no whole file |

---

## 4. Design

Each policy copies the single-responsibility design
(`packages/core/src/quality/policies/single-responsibility.ts`). The policies live in `plugins/quality` after the plugin move.

### 4.1 Shared mechanics

- **Subjects.** The outermost changed class or named function: a scope that has a reviewable class
  or function ancestor is not a subject (open/closed needs this to see a chain in a parent).
- **Requests.** Single responsibility keeps its own request. The new rules share a second request
  for the scopes they select. Request units already run in parallel
  (`plugins/quality/src/review/scope-review.ts:182`), so latency does not grow. In one shared request
  with all three, single responsibility lost 3 of 34 resolves (§5.5).
- **Gate.** `selectScopes` drops a scope whose diff has no line that the rule's gate matches. The
  gate reads both `+` and `-` lines, so an edit that removes a swallow or a chain can still resolve
  a finding. A gated-out scope costs nothing.
- **Questions.** `currentConcern` (noul), `impact` (choice over `EQualityImpact`), and `focus`
  (choice over `scope.evidence` ids, `none` and `uncertain`) only when the scope has evidence (a
  class). Instructions use the same state, untrusted-text and scoping guides as single
  responsibility.
- **Transitions.** The same as `single-responsibility.ts:287-356`, with two thresholds. Introduce:
  concern ≥ T_c and an introduced or worsened impact ≥ T_i. Track debt: concern ≥ T_c otherwise.
  Resolve: concern ≤ 0.2 and a resolved, improved or unchanged impact ≥ 0.8. A contradiction is
  inconclusive. A focus candidate ≥ 0.8 becomes the evidence id.
- **Thresholds.** Jev is sure of the concern and unsure of the impact on both rules, so the two
  are separate. Picked on development data and frozen before any holdout: silent failure
  T_c 0.8 and T_i 0.4, open/closed T_c 0.9 and T_i 0.5 (§5.5).

### 4.2 Silent failure (`silent-failure`, setting `quality.policies.silentFailure`)

- **Definition.** "An error or failed outcome must reach someone who can act on it: it is handled,
  returned as a failure the caller must check, or rethrown. Code that catches, converts or ignores a
  failure so that the caller and the operator cannot tell it happened hides the fault."
- **Violations.** An empty or comment-only catch. A log-only catch that continues as if it
  succeeded. A catch that returns a normal-looking value (`[]`, `{}`, `null`, `0`, `false`, a
  default). A `??` or `||` fallback that hides a failed operation. A returned failure object, a
  Result or an `allSettled` rejection that is ignored.
- **Exceptions.** The failure is rethrown, wrapped, or converted into a typed failure the caller must
  handle. An expected absence by contract (`tryParse`, `findX`, a narrow catch of one expected
  error). Best-effort side work (close a handle, delete a temporary file, write a cache, emit
  telemetry). A top-level boundary that reports the error and turns it into a visible outcome. Test
  code. Unawaited promises, including a `.catch` attached to one (out of scope, §9).
- **Test paths.** `selectScopes` never selects a file under `__tests__/` or named `*.spec.*` or
  `*.test.*`. Jev ignored the test-code exception at 0.84–0.98 (holdout v1).
- **Gate.** A diff line contains `catch`, `.then(`, `finally`, `??`, `||`, `allSettled`,
  `return null|undefined|[]|{}|false`, `ok:`, `.ok`, `error` or `err`.
- **Impact.** Introduced: the edit added a hidden failure that BEFORE did not have (a new scope:
  the new code hides one). Worsened: BEFORE hid a failure and the edit hides another or widens it.
  The other values as single responsibility. Adding a log, count or report to a failure that was
  silent before is improved: no new nudge. If the scope still logs and continues, the concern stays,
  so the finding stays tracked debt and does not resolve.
- **Nudge.** `"Silent failure" suggests that <kind> <name> may hide a failure from its caller
  (concern NN%).` + the definition + `Consider handling, returning or rethrowing that failure. If the
  failure is truly expected or harmless, leaving it unchanged is fine.`

### 4.3 Open/closed (`open-closed`, setting `quality.policies.openClosed`)

- **Definition.** "Code should be open for extension and closed for modification: adding a new
  variant (type, kind, provider, command, format) should add a new type, handler or table entry, not
  edit a growing conditional that dispatches on a type tag, kind or name and holds each variant's
  behavior inline."
- **Violations.** The edit adds a `case`, an `else if` on a tag, an `instanceof` or `typeof` branch,
  or a name comparison to a dispatch chain whose branches hold variant behaviour, and the chain has
  3 or more branches after the edit. The edit adds the same new variant to two or more chains of one
  scope.
- **Exceptions.** The single composition point: a factory or registry with one line per variant, or a
  parser, visitor, reducer or state machine over a closed grammar. Pure value mapping. Branches on
  unrelated conditions (guards, validation, ranges, flags). A closed set that will not grow (days,
  HTTP status classes). The edit adds a handler, table entry or registry entry. Fewer than 3
  branches.
- **Gate.** The file existed before the write (the module scope's `before` is not null), so a chain
  in a new function of an existing file counts as an extension. A diff line matches `^\s*case\b`,
  `\belse\s+if\s*\(`, `\b(instanceof|typeof)\b`, a `kind`, `type` or `tag` comparison with `===`,
  or a ternary on one of them.
- **Impact.** Introduced: the edit created a chain that new variants must edit, or grew a 2-branch
  conditional to 3. Worsened: the edit added a branch to a chain that already had 3 or more.
  Resolved: the edit replaced the chain with handlers or a table.
- **Nudge.** `"Open/closed" suggests that <kind> <name> grew a conditional on a type tag (concern
  NN%).` + the definition + `Consider a handler per variant or a lookup table, so the next variant
  needs no edit here. If this is the one place where variants are composed, leaving it unchanged is
  fine.`

---

## 5. Evals

### 5.1 Baseline dataset

`docs/research/quality-rules-baseline/` holds the cases, the labels and the report. Per rule:
40 synthetic TypeScript cases. Each case is a complete file before and after a write.

| Bucket                                                                              | Silent failure | Open/closed |
| ----------------------------------------------------------------------------------- | -------------- | ----------- |
| positive (notify)                                                                   | 14             | 14          |
| near-miss (an exception applies, or existing debt the edit did not touch, or a fix) | 16             | 16          |
| negative (clean code)                                                               | 10             | 10          |
| edits / creations                                                                   | 29 / 11        | 37 / 3      |

Labels follow the rules in `evals/AGENTS.md` and `evals/code-quality/AGENTS.md`. A drafter agent
wrote each case with its label. A separate reviewer agent labelled the stripped case (path, before,
after) blind, under the rubric only. A case is accepted when both agree on `notify`. The result:
80 of 80 accepted, 0 quarantined. This is **machine-reviewed synthetic evidence**. Both agents are
reasoning agents of unknown, probably the same, model family, and the cases were written to be
clear. Full agreement shows that the rubric is clear. It does not show that real code is this easy.

### 5.2 Baseline result (`gateway/typesafe-ai/jev`, 2026-11-23, 3 trials, majority vote)

The run used the real source adapter, `prepareQualityRequest`, the production Jev client through
Vercel AI Gateway and the draft policies. All three policies were on, so each request was the shared
one. 861 requests, 0 errors.

| Rule                | T   | TP  | FP  | FN  | TN  | Precision | Recall | Trial agreement |
| ------------------- | --- | --- | --- | --- | --- | --------- | ------ | --------------- |
| silent failure      | 0.8 | 9   | 0   | 5   | 26  | 1.00      | 0.64   | 0.975           |
| silent failure      | 0.7 | 11  | 0   | 3   | 26  | 1.00      | 0.79   |                 |
| open/closed         | 0.8 | 11  | 0   | 3   | 26  | 1.00      | 0.79   | 0.975           |
| open/closed         | 0.7 | 14  | 0   | 0   | 26  | 1.00      | 1.00   |                 |
| open/closed, + file | 0.8 | 12  | 0   | 2   | 26  | 1.00      | 0.86   | 0.95            |
- **No false nudge** in 26 non-notify cases per rule, at any threshold from 0.5 up.
- **Margin.** The closest silent-failure negative is a test file that swallows a parse error
  (sf-025): concern 0.76, but impact confidence 0.48, so it stays silent at every threshold tested (0.5–0.95).
  The closest open/closed negative peaks at concern 0.19.
- **Misses.** Silent failure misses log-and-continue (sf-004, sf-005, sf-006) and a parse failure
  that turns into a count (sf-003). The model sees the concern (0.78–0.88) but is not sure of the
  impact (0.45–0.84). The open/closed misses are `worsened` at 0.72–0.79 impact confidence.
- **Gate.** No positive was gated out. Silent failure asks on 38 of 40 cases. Open/closed asks on 33
  of 40. Matching `-` lines adds 2 near-miss cases (the "fixed it" edits), as intended.
- **Single responsibility.** The shared request carries the two new definitions too. This run did not
  compare the single-responsibility answers with and without them. Step 2 runs the
  single-responsibility dataset both ways and must show no regression.

### 5.3 How many cases set a threshold, and the ship bar

With zero false positives in n positive predictions, the 95% Wilson lower bound on precision is
n / (n + 3.84). The baseline gives 9 → 0.70, 11 → 0.74, 14 → 0.78. That is not enough to claim a
precision bar. Each rule needs:
- **120 accepted cases**: 50 positive, 50 near-miss, 20 negative, with every violation shape and
  every exception at least 5 times. At least 30 come from real code (this repository's history
  through `eval:import-history` and other public TypeScript), so that the dataset is not only
  synthetic.
- **Splits.** Development (tune the threshold) and holdout (promote), grouped by case family.
- **Ship bar, on holdout, at the chosen T.** Precision ≥ 0.95 with a 95% lower bound ≥ 0.85
  (in practice: at most 1 false nudge in about 40 predictions), recall ≥ 0.6, trial agreement ≥
  0.95, and no single-responsibility regression on its own dataset with all three policies on.
- **Threshold.** Pick the lowest T in {0.7, 0.8} that passes the bar on development. A rule that
  fails the bar at 0.8 does not ship.

### 5.4 Eval harness change

`evals/code-quality` handles one feature, `code-quality/single-responsibility` (`feature.ts:16`,
`expected.ts` `SrpExpected`). Step 2 makes the feature id and the policy list come from the dataset
manifest (`code-quality/<policyId>`), renames the expected schema to a policy-neutral
`QualityExpected`, and adds `evals/datasets/code-quality/{silent-failure,open-closed}/`. The rubric
for each rule is a section in `evals/code-quality/AGENTS.md`. This lands on top of the evals move
into the plugin, not before it.

### 5.5 Holdout results (2026-11-23, `gateway/typesafe-ai/jev`, 3 trials, majority vote)

Data: `docs/research/quality-rules-holdout/` (v1) and `docs/research/quality-rules-holdout-v2/`
(rule v2 tuning and holdout v2).

**Holdout v1, rule v1, T = 0.8.** 81 accepted cases per rule, real and synthetic. Both rules failed.

| Rule           | TP  | FP  | FN  | TN  | Precision | Recall | Real-code TP / positives |
| -------------- | --- | --- | --- | --- | --------- | ------ | ------------------------ |
| silent failure | 8   | 2   | 18  | 53  | 0.80      | 0.31   | 2 / 9                    |
| open/closed    | 20  | 1   | 11  | 49  | 0.95      | 0.65   | 0 / 7                    |

The silent-failure false positives were both test helpers. Open/closed missed real dispatch that
sat in a parent scope, in a new function of an existing file, or in a ternary. Holdout v1 then
became development data for rule v2 (§4).

**Rule v2 on development data** (121 cases per rule): no false positive anywhere on the grid
T_c ∈ {0.8, 0.85, 0.9} × T_i ∈ {0.4 … 0.8}. Picks: silent failure 0.8 / 0.4 (precision 1.00,
lower bound 0.86, recall 0.58), open/closed 0.9 / 0.5 (1.00, 0.91, 0.82).

**Holdout v2, rule v2, frozen thresholds, real code only, from repositories and commits not used
before.**

| Rule           | Drafted | Accepted | Positives | TP  | FP  | FN  | TN  | Precision | Lower bound | Recall |
| -------------- | ------- | -------- | --------- | --- | --- | --- | --- | --------- | ----------- | ------ |
| silent failure | 50      | 27       | 8         | 6   | 0   | 2   | 19  | 1.00      | 0.61        | 0.75   |
| open/closed    | 45      | 32       | 1         | 1   | 0   | 0   | 31  | 1.00      | 0.21        | 1.00   |
- **No false nudge on real code** for either rule in holdout v2.
- **Too few real positives to prove the bar** in holdout v2 alone. For open/closed, inline variant
  behaviour in a growing chain is about 1% of real edits that match its gate. Real TypeScript
  dispatches through registries, tables, grammars and handler methods, which are exceptions.
  Whether open/closed ships or is dropped waits on Dennis.

**Holdout v3, silent failure only, frozen thresholds** (`docs/research/quality-rules-holdout-v3/`):
90 real-code drafts from 14 repositories, 60 accepted (67% agreement), 24 positive.

| Set                         | TP  | FP  | FN  | TN  | Precision | Lower bound | Recall |
| --------------------------- | --- | --- | --- | --- | --------- | ----------- | ------ |
| holdout v3                  | 10  | 3   | 14  | 33  | 0.77      | 0.50        | 0.42   |
| holdout v2 + v3 (real code) | 16  | 3   | 16  | 52  | 0.84      | 0.62        | 0.50   |
- **Silent failure fails the bar on real code**: precision 0.84 and recall 0.50, against 0.95 and 0.6.
- **The false nudges** come from documented fallbacks, which the rubric's exceptions do not name:
  a decorative-profile read, a sign-in helper that falls back to a default, and a campaign set-up
  that logs and goes on. Jev gives each one concern 0.81–0.88.
- **No threshold reaches the bar.** On the same data (exploratory, not a promotion result), a
  stricter concern threshold removes the false nudges only when recall drops under 0.4: T_c 0.85
  gives 12 TP and 1 FP, and T_c 0.9 gives 6 TP and 0 FP.
- **Labels are hard on real code.** Agreement was 67–72%. Most disagreements are about whether a
  log-and-continue in a background or set-up path is a fault or best-effort work.

- **Label agreement on real code** was 71–72%. Most disagreements were drafts that called a
  documented fallback a swallowed failure, or an edit that only moved a chain an extension.
- **Size bound.** About 5% of selected real scopes go over 48 KB and are skipped, as today.
- **Single responsibility.** In one shared request with both rules, its field answers were the
  same, but 3 of 34 resolves were lost. It keeps its own request (§4.1).

---

## 6. Cost and latency

| Request shape                    | Median input tokens | Max input tokens | Median latency | p95 latency | Median / max bytes |
| -------------------------------- | ------------------- | ---------------- | -------------- | ----------- | ------------------ |
| single responsibility alone      | 2 450               | 3 600            | 131 ms         | 234 ms      | 10.3 KB / 14.3 KB  |
| all three rules, one shared call | 5 500               | 7 900            | 144 ms         | 235 ms      | 24.2 KB / 33.3 KB  |
- **Latency** barely moves: one call per scope, about 145 ms median and 235 ms p95, far inside the
  1 s budget. A write that changes several scopes still makes one call per scope in the same budget.
- **Tokens** go up about 2.2× (the questions of three policies, not the scope, dominate). Output
  goes from about 150 to 360 tokens. Jev cost per scope rises from about $0.00013 to about
  $0.0003 (`jev-quality.md` §4.8).
- **Bounds.** The shared request must fit `state + all questions ≤ 48 KB` (`review-scopes.ts:17-18`).
  The largest baseline request was 33 KB. A bigger scope falls back to one request per policy
  (`review-scopes.ts:189-196`): three calls in the same budget, not a skip.

---

## 7. Decisions (Dennis, 2026-11-23)

1. **Unawaited promises: dropped.** Jev cannot judge them without types, and the review must stay
   fast and cheap because it runs on every file write. No Biome `nursery/noFloatingPromises` either.
2. **Default: on.** A rule that passes the §5.3 bar ships on by default.
3. **Request size.** No rule adds context to a request beyond what §6 measured: the scope, the
   diff, the imports and the evidence. A rule that needs more does not ship.
4. **Both rules dropped.** Neither meets the §5.3 bar on real code (§5.5):
   - **Silent failure.** Across two fresh real-code holdouts at frozen thresholds: precision 0.84
     (lower bound 0.62) and recall 0.50, against ≥ 0.95, ≥ 0.85 and ≥ 0.6. The false nudges are
     log-and-continue or documented fallbacks in background and set-up code. No threshold reaches the
     bar: precision 1.00 needs T_c 0.9, which drops recall to 0.19.
   - **Labels.** Blind labellers agreed on whether to nudge in only 67–72% of real cases, mostly on
     whether log-and-continue in a background path is a fault or best-effort work. A classifier
     cannot be held to a precision bar that its labels do not reach.
   - **Open/closed.** Inline variant behaviour in a growing chain is about 1% of real edits that
     match its gate: 1 positive among 32 accepted real cases. Real TypeScript dispatches through
     registries, tables, grammars and handler methods. The rule would pay for a request on most
     edits that touch a conditional, and would almost never nudge.
   - **Not tried.** A narrower silent-failure rule (only empty or value-returning catch-alls in
     write paths). Dennis chose to stop.

---

## 8. Slices

None. Both rules were dropped (§7). The datasets, labels and reports in `docs/research/quality-rules-*`
are kept as evidence and as a starting point if a narrower rule is ever tried.

---

## 9. Out of scope

- Unawaited or floating promises, in Jev and in the linter (§3.1, §7).
- Any request context beyond §6: types, callers, the whole file.
- Languages other than TypeScript and JavaScript.
- New events, frames or surfaces.
