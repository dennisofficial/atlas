# Spec: two more Jev quality rules — silent failure and open/closed

Status: **draft**, 2026-11-23. Owner: the quality plugin (`plugins/quality`, after the plugin move
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
  Each is on by default only if its eval precision meets the bar in §5.
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
| `dependencyContext` | the file's import statements (`packages/quality/src/source/scope-adapter.ts:178`)                                                                  |
| `evidence`          | member labels of a class (`scope-adapter.ts:118-143`); none for a function                                                                         |

Not in the state: the rest of the file, the definitions of imported types, the callers, and any
type information. Every policy that selects a scope shares one classifier request
(`packages/quality/src/review-scopes.ts:177-197`), so three rules on one scope cost one call.

---

## 3. What each rule needs, and who judges it

### 3.1 Silent failure

| Shape                                                                           | Needs                               | Owner                                                               |
| ------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| empty `catch`                                                                   | syntax only                         | Biome `suspicious/noEmptyBlockStatements` (recommended, on as warn) |
| a promise nobody awaits or handles                                              | the callee's return type            | Biome `nursery/noFloatingPromises` (types domain), **not** Jev      |
| log-only `catch` that continues as if it succeeded                              | the scope                           | Jev                                                                 |
| `catch` or `.catch` that returns a normal-looking value (`[]`, `null`, default) | the scope, the function's contract  | Jev                                                                 |
| fallback (`??`, `\|\|`) that hides a failed operation                           | the scope                           | Jev                                                                 |
| a returned failure object or `allSettled` result that is ignored                | the scope; the callee's shape helps | Jev, partly                                                         |

A classifier cannot tell `save(x);` from `log(x);` without the callee's type, so it cannot judge an
unawaited promise reliably. Biome 2.6.2 has `nursery/noFloatingPromises` with type inference; this
repository does not enable it (94 hits today across `packages`, `apps` and `plugins`, measured
2026-11-23). That shape belongs to the linter. Jev judges only what needs judgment: whether a
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

| Rule           | Can Jev judge it?                                                                                                                                             | Context                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Silent failure | **Partly.** Yes for swallowing catches, hiding fallbacks and ignored failure values. No for unawaited promises, which need types: that part is a linter rule. | the scope and the diff, as today                |
| Open/closed    | **Yes**, judged on the edit.                                                                                                                                  | the scope and the diff, as today; no whole file |

---

## 4. Design

Each policy copies the single-responsibility design
(`packages/core/src/quality/policies/single-responsibility.ts`). The policies live in `plugins/quality` after the plugin move.

### 4.1 Shared mechanics

- **Subjects.** The same as single responsibility (`single-responsibility.ts:94-126`): the
  outermost changed class, else a changed named top-level function. All three policies select the
  same scopes, so they share one request (`review-scopes.ts:177-197`).
- **Gate.** `selectScopes` drops a scope whose diff has no line that the rule's gate matches. The
  gate reads both `+` and `-` lines, so an edit that removes a swallow or a chain can still resolve
  a finding. A gated-out scope costs nothing.
- **Questions.** `currentConcern` (noul), `impact` (choice over `EQualityImpact`), and `focus`
  (choice over `scope.evidence` ids, `none` and `uncertain`) only when the scope has evidence (a
  class). Instructions use the same state, untrusted-text and scoping guides as single
  responsibility.
- **Transitions.** The same as `single-responsibility.ts:287-356`. Introduce: concern ≥ T and an
  introduced or worsened impact ≥ T. Track debt: concern ≥ T otherwise. Resolve: concern ≤ 0.2 and
  a confident resolved, improved or unchanged impact. A contradiction is inconclusive. A focus
  candidate ≥ 0.8 becomes the evidence id.
- **Threshold.** T = 0.8 for both rules at first, the same as single responsibility. §5.3 says when
  T moves to 0.7.

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
  code. Unawaited promises (owned by a linter).
- **Gate.** A diff line contains `catch`, `.then(`, `finally`, `??`, `||`, `allSettled`,
  `return null|undefined|[]|{}|false`, `ok:`, `.ok`, `error` or `err`.
- **Impact.** Introduced: the edit added a hidden failure that BEFORE did not have (a new scope:
  the new code hides one). Worsened: BEFORE hid a failure and the edit hides another or widens it.
  The other values as single responsibility.
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
- **Gate.** `before` is not null (an extension, not a creation), and a diff line matches
  `^\s*case\b`, `\belse\s+if\s*\(`, `\b(instanceof|typeof)\b` or `\.(kind|type|tag|name)\s*===`.
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

`docs/v2/research/quality-rules-baseline/` holds the cases, the labels and the report. Per rule:
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

## 7. Questions for Dennis

1. **Unawaited promises.** Jev cannot see them. Do we turn on Biome `nursery/noFloatingPromises`
   in this repository (94 hits today, one PR to fix them), or leave that shape unowned?
2. **Default.** A rule that passes the §5.3 bar ships on by default. Is that right, or should both
   start off until you have seen them in your own sessions?

---

## 8. Slices

Step 2 starts when the move of quality into `plugins/quality` has merged. Each rule is one `feat`
PR, and each PR ships only if its holdout result passes §5.3.

| #   | Contents                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Eval harness per policy (§5.4); silent-failure policy, settings switch and README in `plugins/quality`; its 120-case dataset with blind labels; TDD specs for gate, questions, interpret and guidance; single-responsibility no-regression run. |
| 2   | The same for open/closed.                                                                                                                                                                                                                       |

**Live check per PR (production v2).** A session writes code that breaks the rule: the tool call
shows the rule's indicator and the next step carries the note once. A clean write gets no note. A
second write that keeps the problem gets no second note. Every probe session is archived and every
minted `AuthSession` row is deleted.

---

## 9. Out of scope

- Unawaited promises in Jev (§3.1).
- Languages other than TypeScript and JavaScript.
- Type information, callers or the whole file in the request.
- New events, frames or surfaces.
