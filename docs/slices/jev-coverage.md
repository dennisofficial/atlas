# Spec: Jev coverage — telemetry, labels and more flags

Status: **draft for Dennis**, 2026-11-25. Nothing is built. Owner: the quality plugin
(`plugins/quality`). Builds on `jev-quality.md` (the review), `quality-rules.md` (the ship bar and
the dropped rules) and `classifier.md` (the port). Anchors read at `bbb93561c`.

Dennis, 2026-11-25: "Jev should definitely flag more. We need a lot of telemetry and analytics to
understand if it's actually working well or not."

---

## 1. Summary

- **Jev flags almost nothing, and we cannot tell if that is correct.** In 28 hours, 3,697 reviews
  gave 5 nudges. 4 of the 5 were in probe or live-check files. The 1 real nudge was a false
  positive (a DB migration). Real true flags: 0.
- **The bottleneck is the policy and its score, not the infrastructure.** 41% of reviews reach the
  classifier. Of the reviews it scores, 0.6% get a concern of 0.8 or more. Deadlines (1 miss) and
  latency (p95 330 ms) are not a cause.
- **Recall is not measured anywhere.** No telemetry sends unflagged code, and the SRP evals have no
  precision or recall number (`quality-rules.md` numbers are for the dropped rules). This is the
  first gap to close.
- **Plan.** (1) Trace every classifier call as a PostHog `$ai_generation` with its code, for every
  user, secret-safe. (2) Send one metadata event per scored scope. (3) A routine labels a
  stratified sample every run into a PostHog dataset, so precision and recall are measured on real
  code. (4) Only then tune thresholds per policy, widen scope coverage, and try new general rules,
  each at the ≥ 0.95 precision bar.
- **Target.** At least 20 real nudges per week across all policies, at precision ≥ 0.95 (95% lower
  bound ≥ 0.85) and recall ≥ 0.6, both measured on labelled real code.

---

## 2. The funnel today (PostHog, 2026-11-24 15:56 → 2026-11-25 19:36 UTC, about 28 h)

All reviews came from one user (Dennis). 85% ran in sub-agent threads (3,130 of 3,698).

| Step                                         | Count | Share | Source                                             |
| -------------------------------------------- | ----- | ----- | -------------------------------------------------- |
| Write tool calls with a captured file change | n/a   |       | not sent (gap G1)                                  |
| Reviews recorded                             | 3,697 | 100%  | `quality review completed`                         |
| Skipped: `outside_workspace`                 | 649   | 17.6% | correct (routine run 1: context, `/tmp`)           |
| Skipped: `unsupported_language`              | 350   | 9.5%  | extension not sent (gap G2)                        |
| Skipped: `oversized_request`                 | 189   | 5.1%  | request over the 24 KB / 48 KB bound in force then |
| Skipped: `invalid_syntax`                    | 67    | 1.8%  |                                                    |
| Skipped: other, deadline                     | 2     | 0.1%  | 1 `source_unavailable`, 1 `review_deadline`        |
| Completed, no scope selected                 | 936   | 25.3% | module-only change, never sent to Jev              |
| Completed, at least one scope scored (SRP)   | 1,504 | 40.7% |                                                    |
| Max concern ≥ 0.8                            | 9     | 0.24% | 5 `new_finding`, 4 `tracked_debt`                  |
| Nudged                                       | 5     | 0.14% | 4 probes, 1 false positive                         |

Concern distribution of every scored review (`max_confidence`, the highest concern over the
review's scopes; per-scope scores are not sent, G4):

| Concern bucket | 0.0 | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 |
| -------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Reviews        | 229 | 396 | 295 | 230 | 176 | 99  | 62  | 8   | 5   | 4   |

Other facts:
- Classifier latency p50 192 ms, p95 330 ms, max 719 ms. Input tokens p50 4,482, p95 14,350.
- `quality finding ignored`: 4 (all SRP, 3 of 4 probes). `quality finding resolved` and `closed`: 0.
- `quality example flagged`: 2. `probe/widget.ts` (real problem, probe file) and a migration class
  in `packages/db/migrations/…/migration.ts` (false positive: the framework fixes the class shape).
- Routine run 1 (session `58d3f143`) labelled these 2 in its chat report only. No label is stored.

### 2.1 Where a write drops out (code)

1. Only `write`, `edit` and `multi_edit` give file changes
   (`apps/api/src/agent/agent-tools/write.ts:130`, `edit.ts:86`, `multi-edit.ts:139`). `bash` has
   the `Destructive` effect (`bash.ts:54`), so a shell write is never reviewed. A `Write`-effect tool
   with no file change (mcp-edit, skills, memory) drops silently (`plugins/quality/src/pod/hook.ts:66`).
2. Classifier off (no model or a plan-only connection,
   `packages/classifier/src/availability.ts:20-40`) or `quality.enabled` false: the hook returns
   `{}` with no record and no event (`hook.ts:56-69`). We cannot see these users (gap G1).
3. Extensions: only `.ts .tsx .mts .cts .js .jsx .mjs .cjs`; `.d.ts` is `declaration_only`
   (`plugins/quality/src/review/source/typescript-parser.ts:39-68`).
4. SRP selects only top-level classes and named functions (top-level arrow `const` included). It
   never selects the module scope or a method on its own
   (`plugins/quality/src/policies/single-responsibility/select.ts:29-61`). A file of object
   literals, types, constants or `export default` arrows reaches no classifier. That is the 936.
5. Request bound: Jev's default limits, 32k tokens per question and 64k per request, expressed as
   72,960 bytes for `state + longest question` and 145,920 bytes for `state + all questions`
   (`plugins/quality/src/review/review-scopes.ts:18-28`).
6. Budget 1000 ms + 10 ms grace (`hook.ts:29`, `plugins/quality/src/review/deadline.ts:1`). A late
   review is recorded and never nudges (`plugins/quality/src/pod/review-outcome.ts:137-192`).
7. Nudge only on `introduce`: concern ≥ 0.8 **and** impact confidence ≥ 0.8 **and** impact
   `introduced` or `worsened` (`plugins/quality/src/policies/single-responsibility/interpret.ts:19-22,184-202`).
   Concern ≥ 0.8 with an unsure or old impact is `tracked_debt` and never nudges. 4 of the 9
   high-concern scopes stopped here.
8. A finding nudges once per episode (`plugins/quality/src/review/ledger.ts:102-106`).

### 2.2 Why Jev flags so little — answer

| Suspect          | Evidence                                                                            | Verdict                           |
| ---------------- | ----------------------------------------------------------------------------------- | --------------------------------- |
| Deadline         | 1 miss in 3,697; p95 330 ms of 1000 ms                                              | not a cause                       |
| Language         | 9.5% skipped; we do not know which extensions                                       | small; measure first (G2)         |
| Scope extraction | 25% of reviews have no SRP subject; module scope never asked                        | real coverage loss                |
| Policy set       | one policy (SRP); agent code rarely mixes responsibilities in one class or function | main cause                        |
| Threshold        | 8 reviews at 0.7–0.8, 62 at 0.6–0.7; impact gate turns 4 of 9 into debt             | possible lever, precision unknown |
| Model            | no recall data: we cannot tell clean code from a model that under-scores            | unknown (G3)                      |

### 2.3 Telemetry gaps

- **G1** No event when the review does not run: classifier off, setting off, or a write through
  `bash`. We cannot see users who never get Jev.
- **G2** The skip event has no file extension and only the first skip reason
  (`plugins/quality/src/pod/analytics/review-properties.ts:53-54`).
- **G3** No unflagged code is sent, so recall cannot be measured. Only nudged findings carry an
  excerpt, and only for the allowlist (`apps/api/src/agent/config/quality-settings.ts:21-33`).
- **G4** The review event sends only the max concern per policy. It does not send the impact, the
  impact confidence, the scope kind, the scope size, the change kind (created or edited) or the
  transition per scope.
- **G5** `outcome` is misleading. `resolved` means "concern ≤ 0.2 and a confident unchanged or
  improved impact" (877 of 1,504), not a fixed finding. A repeat `introduce` on a notified finding
  maps to `clean` (`review-properties.ts:66-77`).
- **G6** The classifier returns no output tokens and no cost (`packages/classifier/src/jev.ts:24-35`).
- **G7** The agent's reaction to a nudge is only "still active at turn end". We do not know if it
  edited the scope, or answered the finding in its reply.
- **G8** Labels live only in a routine's chat report. Each run labels from zero.

---

## 3. PostHog LLM analytics — what it covers

Sources: the PostHog MCP skills `instrument-llm-analytics` (`manual-capture.md`, `traces.md`,
`calculating-costs.md`), `exploring-llm-evaluations`, `analyzing-offline-evaluations`,
`querying-posthog-data` (`models-datasets.md`, `models-ai-observability-reviews.md`).

| Feature                                                                                                          | What it gives Jev                                                                                       | Fit     |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------- |
| `$ai_generation` (manual)                                                                                        | One event per call: `$ai_input`, `$ai_output_choices`, model, tokens, latency, error, cost; trace UI    | yes     |
| `$ai_trace_id` / `$ai_span`                                                                                      | Group the calls of one review                                                                           | yes     |
| Score definitions + trace reviews (`llma-score-definition-*`, `llma-trace-review-create`, `llma-review-queue-*`) | Agent-writable labels on a trace, stored in `system.trace_review_scores`                                | yes     |
| Datasets (`llma-dataset-*`)                                                                                      | Versioned items: `input`, `expected_output`, `metadata`, `source_trace_id`, idempotent `client_item_id` | yes     |
| Offline experiments (`llma-offline-experiment-*`)                                                                | Store the results of our own eval run against a dataset, per scorer version                             | yes     |
| Online evaluations                                                                                               | `hog` (code) or `llm_judge` (needs a BYOK key and AI data approval) on live generations                 | not now |
| Clustering, summaries                                                                                            | Unsupervised grouping and prose summaries of traces                                                     | not now |

Facts that shape the design:
- **The project has no `$ai_*` events, datasets, evaluations or scorers today.** The repository has
  no `$ai_` code (`grep -rn '\$ai_' packages plugins apps`: 0 hits). Atlas does not trace the
  agent's own model calls, so there is no separate question for Dennis about them.
- `$ai_input` and `$ai_output_choices` stay 30 days in `posthog.ai_events`. Metadata stays in
  `events`. Datasets expire after 90 days with no write.
- 100k `$ai_*` events per month are free, then $0.00035 per event and less at volume. Jev makes
  about 1,500 calls per day today: about 45k per month.
- The regular capture limit is 1 MB per event. A Jev request carries at most 143 KiB of state and
  questions together, and is usually a few KB.

What our own product events still must cover: the review funnel (skips and their reasons, which
never reach a model), the nudge decision, the agent's reaction, and the link from a label to the
nudge. LLM analytics sees only the call.

**Design (recommended):** PostHog LLM analytics for the classifier calls, the labels and the real
eval set. Our product events for the funnel, the per-scope scores and the reactions. Both share
`review_id` (= `$ai_trace_id`). LLM tracing covers Jev only. It never traces the agent's model
calls or user conversations.

---

## 4. Privacy rules (Dennis, 2026-11-25)

- Code excerpts and Jev traces go out for **every user**. The allowlist
  `ATLAS_QUALITY_EXAMPLE_USERS` (`apps/api/src/agent/config/env.ts:124`) and the `examples` setting
  (`quality-settings.ts:8-33`) are removed. `ESettingId.QualityRecordExamples`
  (`packages/core/src/settings/registry.ts:68`) has no reader and is removed too.
- The secret filter applies to every user. When `looksSecretShaped({ path })` or
  `namesASecretLiteral({ text })` (`packages/core/src/policy/classifier/shapes.ts:62,84`) hits the
  path, the before text or the after text, the event keeps its metadata and drops all code:
  `$ai_input` and `$ai_output_choices` are omitted and `code_withheld: 'secret'` is set.
- **No session content.** No conversation text, prompt, agent message, transcript or tool output.
  The only code is the reviewed scope and the request state that Jev saw.
- **No raw session or thread id on Jev events.** `analyticsOf`
  (`packages/host/src/holder/pod-analytics.ts:4-16`) adds raw `session_id` and `thread_id` to every
  plugin event. Jev events send `session_hash` and `thread_hash` (SHA-256 of the id, first 16 hex)
  and `thread_kind` (`main`, `sub_agent`, `teammate`) instead. Never the title.

---

## 5. Telemetry design

### 5.1 `$ai_generation` — one per classifier call

Sent by a tracing wrapper around `ctx.classifier` that the hook builds per review. It sees the
request state, the answers, the latency and the usage.

| Property                                     | Value                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `$ai_trace_id`                               | `review_id` (new UUID per hook run)                                                                |
| `$ai_span_id`, `$ai_span_name`               | request id; `jev:<policy ids>`                                                                     |
| `$ai_model`, `$ai_provider`, `$ai_base_url`  | the configured classifier model, `jev` or `openai`, the endpoint                                   |
| `$ai_input`                                  | `[{ role: 'user', content: <request state JSON + question ids> }]`; omitted on a secret            |
| `$ai_output_choices`                         | `[{ role: 'assistant', content: <raw answers JSON> }]`; omitted on a secret                        |
| `$ai_input_tokens`, `$ai_output_tokens`      | from usage; output is null until the transport returns it (G6)                                     |
| `$ai_latency`                                | seconds                                                                                            |
| `$ai_is_error`, `$ai_error`                  | fault kind (`timeout`, `http`, `malformed`, `aborted`)                                             |
| `$ai_input_cost_usd`                         | tokens × the input price in the classifier model table (`packages/classifier/src/models.ts:17-42`) |
| `review_id`, `scope_id`, `policy_ids`        | links                                                                                              |
| `path`, `line_start`, `line_end`             | workspace-relative path and after range                                                            |
| `code_withheld`                              | `null` or `secret`                                                                                 |
| `session_hash`, `thread_hash`, `thread_kind` | §4                                                                                                 |

### 5.2 `quality scope assessed` — one per scope × policy (metadata only)

The backbone for score distributions, near-misses and per-policy rates.

| Property                                                          | Value                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `review_id`, `scope_id`, `policy_id`, `policy_version`            | links                                                                    |
| `scope_kind`, `change_kind`                                       | `class`, `function`, `module`; `created` or `edited`                     |
| `language`, `extension`                                           | `typescript`; `.tsx`                                                     |
| `scope_lines`, `scope_bytes`, `diff_lines`, `request_bytes`       | sizes                                                                    |
| `concern_score`, `impact`, `impact_confidence`, `focus_confident` | the answers                                                              |
| `transition`                                                      | `introduce`, `track_debt`, `resolve`, `none`, `inconclusive`             |
| `verdict`                                                         | `nudged`, `repeat`, `tracked_debt`, `near_miss`, `clean`, `inconclusive` |
| `near_miss`                                                       | true when not nudged and (concern ≥ 0.5 or `tracked_debt`)               |
| `concern_threshold`, `impact_threshold`                           | the thresholds in force, so a later change is visible in the data        |
| `deadline_missed`, `classifier_ms`                                |                                                                          |
| `session_hash`, `thread_hash`, `thread_kind`                      | §4                                                                       |

### 5.3 Changes to existing events

- `quality review completed`: add `review_id`, `skip_reasons` (all reasons), `extensions`, `tool`
  (`write`, `edit`, `multi_edit`), `scopes_total`, `scopes_selected`, `thread_kind`, hashes.
  Rename `max_confidence` to `max_concern`. Replace `outcome` with `verdict` from §5.2 (fixes G5).
  Drop `session_id` and `thread_id` (§4).
- New `quality review unavailable`, once per session per reason: `classifier_off`,
  `setting_off`, `bash_write` (a `bash` call whose command writes into the workspace is out of
  scope to review; count only). Fixes G1.
- `quality example flagged`: removed. `$ai_generation` carries the code for every call.
- New `quality nudge reaction`, once per nudged finding, at the end of the turn that got the nudge.
  Replaces `quality finding ignored`.

| Property                                                                       | Value                                                                                                                |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `reaction`                                                                     | `fixed` (resolved or closed in the turn), `edited_still_flagged`, `untouched`                                        |
| `mentioned_in_reply`                                                           | true when the agent's text after the nudge names the scope or the policy title. The pod computes it; no text is sent |
| `steps_after_nudge`, `turns_after_nudge`, `concern_at_nudge`, `concern_at_end` |                                                                                                                      |
| `review_id`, `policy_id`, hashes                                               | links                                                                                                                |

`quality finding resolved` and `quality finding closed` stay as the lifecycle events, with hashes.

#### S1b: oversized scopes

Measured 2026-11-25 against production, then against the live classifier. The 28 h window holds 200
`oversized_request` skips (5.4% of 3,697 reviews) and 0 `oversized_source`. Every one is a
single-policy (SRP) request: 148 class scopes, 52 function scopes. The scope's line span is p50 509,
p90 1,540, max 1,855.

30 of the 200 were rebuilt exactly and checked against the record's before and after hashes. Their
request state is 20.4–92.3 KB (p50 28.5 KB, p90 54.5 KB), with before p50 8.1 KB and after p50
8.6 KB. All 30 failed the old 24 KB bound (`state + longest question`), and 5 also failed the 48 KB
bound, so with one policy the 24 KB bound was the binding one.

**The classifier's limits.** Default context is **32k tokens per question** (state + any one question)
and **64k per request** (state + all questions), input at **$0.042 per million tokens**, output free
(`docs.typesafe.ai/models`). TypeSafe offers a 262k-token mode behind the
`TypeSafe-Danger-Zone-Long-Context: true` header, and the gateway forwards it, but it is not used:
TypeSafe calls that mode experimental and less accurate, says it is "not reliable enough to endorse for
production", and publishes no accuracy numbers for it (`docs.typesafe.ai/models`,
`docs.typesafe.ai/model-jaggedness`). A scope that needs more than the default limits is reviewed as
an excerpt instead. That is Dennis's decision of 2026-11-25.

The production model is pinned to **`typesafe-ai/jev-1.14.0`** (`packages/classifier/src/models.ts`),
not the moving `typesafe-ai/jev` alias; both ids answer 200 on the gateway, and `typesafe-ai/jev-latest`
is a 404 there. The model ref stays `gateway/typesafe-ai/jev`, so a stored `ClassifierModel` setting
keeps resolving and no account has to pick the model again.

**Live probe, 2026-11-25.** Requests built with the real source adapter and `prepareQualityRequest`
from a synthetic `Ledger` class whose one changed line sits in the middle, and posted to
`https://ai-gateway.vercel.sh/typesafe/v1/systemone` with the pinned model and no header. Latency is
the median of 5 runs (3 for the last row), one client at a time.

| Source lines | State bytes | Input tokens | Median ms |
| -----------: | ----------: | -----------: | --------: |
|          398 |      27,667 |       11,386 |       335 |
|          783 |      53,847 |       20,626 |       364 |
|        1,053 |      72,289 |       27,188 |       361 |
|        1,169 |      80,409 |       30,204 |       472 |
|  3 questions |      38,139 |       50,960 |       710 |

The last row is the largest legal request: a 14k-token state with three 12.5k-token questions, which
is 26.5k per question and 51k in total. **Measured 2.44 bytes per token at the small end, 2.66 in the
range that matters**, and 2.91 on real code (`packages/db/migrations/app/20261022T0209_baseline/migration.ts`,
70 KB, a 1,739-line module scope at 145,691 bytes and 50,010 tokens).

**The bounds.** `plugins/quality/src/review/review-scopes.ts:18-28`:
- `MAX_STATE_AND_LONGEST_QUESTION_BYTES` = `floor(32,000 × 0.95 × 2.4)` = **72,960 bytes**.
- `MAX_STATE_AND_ALL_QUESTIONS_BYTES` = `floor(64,000 × 0.95 × 2.4)` = **145,920 bytes**.
- The 0.95 headroom and the 2.4 bytes per token are the safety margin: at the bound the request is about
  27.2k tokens by the measured ratio (85% of 32k), and 30.4k tokens if the tokenizer is as dense as
  2.4.
- The 1 MiB source cap stays. It is not the binding limit: a scope over the request bound is excerpted
  long before a file reaches 1 MiB.

A request inside the bounds is sent whole. One above them is rebuilt by `source/scope-excerpt.ts` as the
changed lines with 25 lines of context (capped at 90 per side), the member outline (capped at 60
entries) and the changed evidence (capped at 32), and the state flags `scope.excerpt` with the context
size, the start line and the omitted line counts so the labelling loop can measure that stratum. An
excerpt that still does not fit is skipped as `oversized_request`, as before; that now needs a single
line over 70 KB, because the excerpt cuts by line.

**Latency and the budget.** Every legal request measured finishes inside the 1,000 ms review budget
(`plugins/quality/src/pod/hook.ts:29`): 361 ms at the per-question bound and 710 ms at the largest
legal request. The budget is therefore not the constraint at these limits, and `JEV_TIMEOUT_MS` 2,000 ms
is not either.

**Cost.** Production on 2026-11-25 (about 21 h, PostHog `quality review completed.input_tokens`): 1,003
reviews, 5.76M input tokens, p50 4,516 and p95 15,545 tokens per review → **about $0.24/day, about
$7–10/month**. Per review: p50 $0.00019, p95 $0.00065.

The newly reviewed scopes are those 200 skips in 28 h, about 171 a day. At the population's line span
and 108.8 bytes of state per line, about 6 in 10 fit whole (a mean of roughly 45 KB of state, or 17k
tokens) and 4 in 10 go as an excerpt (about 4k tokens). That is about 2.0M tokens a day → **about
$0.08/day, about $2.50/month**, with a range of $2.50–4.40 across the rebuilt sample and the population
projection. Total projected: **about $10–13 a month**.

**Before and after.** Rebuilt set, 30 cases. Every one is reviewed now; how many go whole follows
from the 72,960-byte bound, and the sample's p90 state of 54.5 KB puts at most 3 of the 30 (those above
the p90, up to the 92.3 KB max) on the excerpt path:

| Path                        | Before | After                                     |
| --------------------------- | ------ | ----------------------------------------- |
| Sent whole                  | 0      | at least 27 (state at the p90 is 54.5 KB) |
| Sent as an excerpt          | 0      | at most 3 (state up to 92.3 KB)           |
| Skipped `oversized_request` | 30     | 0                                         |

Population: the 200 skips become 0 unless a scope's excerpt cannot fit, which needs one line over
70 KB. No scope that fits today changes: the planner returns its request byte-identical and a spec pins
it. A pathological 900 KB single-line change is still skipped as `oversized_request`.

### 5.4 Dashboard "Jev quality" (2407147) — insights to add

1. Funnel per day: reviews recorded → reached the classifier → scored → near-miss → concern ≥ T →
   nudged (trends, stacked).
2. Skips by reason and by extension.
3. Concern histogram per policy, per week (`quality scope assessed`).
4. Nudges per 100 scored scopes per policy, excluding `probe/` paths.
5. Nudge reactions (`reaction` × `mentioned_in_reply`).
6. Precision and recall on labelled real code, per policy, per week (SQL insight over
   `system.trace_review_scores` joined to `$ai_generation`; formula in §6.3).
7. Classifier p50 / p95 latency and cost per day (`$ai_generation`).
8. Label agreement rate per run.
9. Unavailable reviews by reason.

---

## 6. The labelling loop

### 6.1 Stores

- **Labels:** one PostHog score definition per policy, `jev-<policy>-should-nudge`, categorical
  `nudge`, `no_nudge`, `unsure`. Each label is a trace review on the call's `$ai_trace_id`.
- **Real eval set:** one PostHog dataset per policy, `jev-<policy>-real`. An item is
  `input` = the request state, `expected_output` = `{ notify, impact }`, `metadata` =
  `{ stratum, inclusion_probability, extension, scope_kind, change_kind, labelled_at }`,
  `source_trace_id`, and `client_item_id` = the generation event id (idempotent).
- **Not the repository.** The repository is public, and real code from other users must not go
  into it. The synthetic and historical sets in `evals/datasets/code-quality/` stay.

### 6.2 Each routine run (every other day, "Quality: maintain Jev")

Two commands do the whole loop. The routine runs them instead of spawning a labelling sub-agent
per scope and hand-copying code through the PostHog MCP tool.
1. **Sample and label blind:** `bun run --cwd evals eval:jev-label --since <iso> --out-dir <scratch>`.
   It samples from `quality scope assessed` joined to its `$ai_generation` since the last run: every
   nudge, every near-miss up to 20, 20 random from the rest; one item per trace, keyed by a seeded
   hash. It skips `code_withheld` calls and traces that already carry a review on the score
   definition, records each item's stratum and inclusion probability, fetches the recorded state
   verbatim (md5 checked, never re-serialised) and labels it with two model families,
   `anthropic/claude-opus-5.5` and `openai/gpt-5.5`. Each labeller sees only the path, before,
   after, diff, dependency context and `evals/code-quality/srp-label-rubric.md`, never Jev's answer.
   Two families rather than two samples of one model is what makes their agreement evidence.
   `--out-dir` holds real code and stays outside the repository.
2. **Publish:** `bun run --cwd evals eval:jev-publish --dir <scratch> --results <results.jsonl>`.
   Agreement writes the trace review on the generation trace. A disagreement puts the trace in the
   review queue for Dennis instead of a review: PostHog refuses to queue a trace that already holds
   a review, and it clears a pending queue item when a review is saved, so the two cannot both
   exist. The person who resolves the queue item writes the label. Agreed items join
   `jev-<policy>-real` through `client_item_id`, so a retry skips what the dataset already holds.
3. **Replay:** `bun run --cwd evals eval:jev-real --items <scratch>/items.jsonl --out <results.jsonl>`
   runs the current classifier and thresholds on every labelled item, then `eval:jev-publish
   --results` records that run as an offline experiment on the suite `single-responsibility-real`
   with the pinned scorer version (`typesafe-ai/jev-1.14.0`, run source `scheduled`). This shows a
   threshold or rule change on all labelled real code, not only on new traffic.
4. **Measure.** Live precision, weighted recall and agreement (§6.3), in the report and the dashboard.

### 6.3 Measures

- Precision = labelled `nudge` among nudged items / all labelled nudged items.
- Recall = Σ(w · TP) / Σ(w · labelled `nudge`), with w = 1 / inclusion probability (stratified
  Horvitz–Thompson). Near-misses are oversampled, so the weights matter.
- Report the 95% Wilson lower bound with each precision, as `quality-rules.md` §5.3 does.
- Agreement = agreed items / labelled items. A policy whose real agreement is under 0.85 cannot be
  held to a 0.95 precision bar (`quality-rules.md` §7.4).

---

## 7. How to flag more without junk

All three levers wait for 2 weeks of labels (about 300 labelled scopes per policy). Each change
must pass the `quality-rules.md` §5.3 bar on labelled real code: precision ≥ 0.95, lower bound
≥ 0.85, recall ≥ 0.6. No Atlas-specific rule.

| Lever                 | Evidence today                                                        | Plan                                                                                                   |
| --------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Per-policy thresholds | 8 reviews at concern 0.7–0.8, 62 at 0.6–0.7; impact gate holds 4 of 9 | Precision/recall curve over T_c × T_i on the real set (§6.2 step 5). Pick the lowest pair that passes. |
| Module scope          | 25% of reviews have no subject                                        | SRP on the module scope when a file has no class or function subject. Eval on real items first.        |
| Language coverage     | 9.5% skipped, extensions unknown                                      | Measure `extensions` for 2 weeks. Add a parser only for a language over 5% of code writes.             |
| New general rules     | SRP is the only rule; silent failure and open/closed dropped          | One candidate at a time. Gate 1: label agreement ≥ 0.85 on 30 real cases. Gate 2: the §5.3 bar.        |

New-rule candidates, all general and visible in the scope and the diff, none caught by Biome:
1. **Narrating comment**: a comment restates what the next line of code does.
2. **Misleading name**: a function or variable name says one thing, the body does another.
3. **Duplicated logic**: the scope repeats a block that it or the file already has.

Known false positive: a class whose shape a framework fixes (migrations). A text exception was
tried in #2958 and parked: it lost 6 warranted notification trials, and one lifecycle class lost
all 3 trials. See §11.5. The case moves into the SRP v2 eval (S6).

**Target.** At least 20 real (non-probe) nudges per week across all policies, at precision ≥ 0.95
(lower bound ≥ 0.85) and recall ≥ 0.6 on labelled real code. Today: about 1 real nudge per day,
precision 0/1.

---

## 8. Slices

| #   | Slice                                                                                                                                                                     | Depends on |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| S1  | Hashed links in pod analytics; `quality scope assessed`; review event changes; `quality review unavailable`; remove the allowlist, `examples` and `QualityRecordExamples` | —          |
| S2  | Tracing classifier wrapper: `$ai_generation` per call, secret filter, price in the model table                                                                            | S1         |
| S3  | `quality nudge reaction`, replacing `quality finding ignored`                                                                                                             | S1         |
| S4  | Score definitions and datasets; routine prompt with §6.2; `eval:jev-real` loader and offline-experiment publish                                                           | S2         |
| S5  | Dashboard insights §5.4                                                                                                                                                   | S1–S3      |
| S6  | SRP v2: atomic Choice predicates composed in code, pinned model; eval against SRP v1 on the real set (§11.1)                                                              | S4         |
| S7  | Verifier stage: narrow Jev questions with retrieved context confirm each candidate; publish only verified findings (§11.3)                                                | S4, S6     |
| S8  | One new rule with concrete evidence, then thresholds and module scope (§11.4)                                                                                             | S4, S7     |

Each slice ships with specs in `plugins/quality/src/**/__tests__/` and a live check in a real
session: the event lands in PostHog with the expected properties and no raw session id.

---

## 9. Decisions for Dennis

1. **Real eval set in PostHog datasets, not the repository.** Recommended: yes. The repository is
   public, and the set holds other users' code.
2. **Trace every classifier call with its code, for every user.** About 45k `$ai_*` events per
   month, inside the free 100k. Recommended: yes.
3. **Hash the session and thread ids on all Jev events, and drop the raw ids.** Recommended: yes.
   Other plugins keep raw ids; that is a separate question.
4. **Two blind labeller agents per item, disagreements to your review queue.** Recommended: yes.
5. **No threshold or scope change before 2 weeks of labels.** Recommended: yes. Fix only the
   framework-shape false positive now.
6. **First new rule to try: narrating comment.** Recommended: yes, behind gate 1 (agreement).
7. **Target: 20 real nudges per week at precision ≥ 0.95 and recall ≥ 0.6.** Recommended: yes.

---

## 10. Out of scope

- Long-context mode (`TypeSafe-Danger-Zone-Long-Context`) until it is measured on the real set (§11.2).

- Tracing the agent's own model calls, conversations or any session content.
- Reviewing `bash` writes. Only counted (§5.3).
- Online LLM-judge evaluations (they need a BYOK key and AI data approval).
- The dropped silent-failure and open/closed rules (`quality-rules.md` §7).

---

## 11. Research findings (2026-11-25) and what they change

Sources: docs.typesafe.ai (`/model-jaggedness`, `/concepts/how-to-build-with-system-one`,
`/primitives/choice`, `/confidence`, `/models`); cursor.com/blog (`building-bugbot`,
`bugbot-learning`); the Semgrep blog (2025, "96%").

### 11.1 The SRP questions have the shape Jev does badly

TypeSafe documents three weak spots: counting, abstract multi-hop judgments, and the calibration
of Score levels. "Does this scope mix independently changing responsibilities" needs all three.
This probably explains the low concern scores (most reviews score 0.0–0.3, §2).

SRP v2 (slice S6):
- Atomic, literal, observable predicates. For example: "does the scope call a network or HTTP
  client", "does it write files", "does it build SQL or a schema", "does it render markup",
  "does it format an outbound message". Each predicate is a Choice with contrastive criteria:
  what qualifies, what does not, and one example of each.
- Code composes the answers deterministically. For example, two or more unrelated concern
  families in one class or function, and the edit added one of them.
- Threshold the probability of the relevant option. Do not use a Score expectation or
  `confidence`.
- Pin the model version (`jev-1.14.0`), not the `jev-latest` alias, so a model release cannot
  move the thresholds.
- Ship bar: against SRP v1, on the labelled real set (§6), at the §7 bar.

### 11.2 Long context

The default limits are 32k tokens per question (state plus one question) and 64k per request.
TypeSafe calls the 262k long-context mode experimental and less accurate, and publishes no
accuracy numbers for it. So S1b sets the bounds to the default limits in tokens. Above them, Jev
reviews an excerpt of the changed region (S1b). Long context stays off until it is measured on
the labelled set.

### 11.3 Two stages

Bugbot's main precision lever: a permissive screen finds candidates, and a separate verifier
looks for evidence for each one. Only verified findings reach the agent. For Jev (slice S7), the
screen is the S6 predicates at a lower threshold. The verifier is a second set of narrow Jev
questions per candidate, with the context it needs retrieved (callers, the convention in the
sibling files). It does not use long context.

### 11.4 Next rules

Rules with concrete evidence in the code do better than abstract design judgments: a contract
mismatch, a missing failure branch, a resource without cleanup, a boundary condition, an exposed
credential. "Narrating comment" (§7) stays first only if its eval passes gate 1 and gate 2.
Otherwise the next rule comes from this list.

### 11.5 Metrics

- `quality nudge reaction` (fixed or not) measures usefulness, not precision. The precision bar
  stays on human and agent labels (§6).
- Dedupe repeated findings across writes: count one finding (`finding_id`, `episode`) once in
  every rate.
- #2958 (framework-shape text exception) is parked. Live eval, 3 trials: warranted notification
  trials went from 15/27 to 11/27. 7 notifications were lost and 2 gained. One lifecycle class
  lost all 3 trials, with impact probability falling from 0.86–0.89 to 0.57–0.64. A text exception
  that names a broad category leaks into nearby cases. That is one more reason for §11.1.

---

## 12. Status and handoff for S5–S8 (2026-11-25)

### 12.1 What is done

| Slice   | PR           | What it gives                                                                                                                                       |
| ------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1a     | #2961, #2972 | `quality scope assessed`, `review_id`, hashed session and thread ids, `quality review unavailable`; allowlist and `quality example flagged` removed |
| S1b     | #2957        | Bounds at Jev's default limits (32k / 64k tokens), excerpt above them, model pinned to `typesafe-ai/jev-1.14.0`                                     |
| S1c     | #2977        | One parse per text and a parse cache: replay scope build p95 94.5 → 24.1 ms                                                                         |
| S2      | #2970        | One `$ai_generation` per classifier call, with code for every user unless the secret filter matches                                                 |
| S3, S3b | #2969, #2976 | `quality nudge reaction`; `review_id` = sha256(call id), first 32 hex, durable                                                                      |
| S4      | #2980        | `eval:jev-real`; PostHog score definition, dataset and review queue; routine check 2 labels every other day                                         |
| S5      | no code      | Dashboard 2407147 in five groups: funnel, latency and cost, scores, usefulness, accuracy (§12.6)                                                    |

Live checks passed for S1a, S2, S3 and S3b on 2026-11-25. The routine's check 1 owes the 24 h
numbers for S1b (oversized skips, expected near 0) and S1c (`review_deadline` per hour, which rose
to 1–8 per hour on 2026-11-25 18:00–22:00 UTC). First numbers from the S5 dashboard, 2026-11-26 00:00
UTC: 0 oversized skips in 197 reviews since the S1b deploy (21:00 UTC), against 63 in 1,320 reviews
at 18:00–22:00. 0 deadlines in 32 reviews in the 45 minutes after the S1c deploy, against 14 in
4 hours (3.5 per hour) at 18:00–22:00. Check 1 still owes the full 24 h.

### 12.2 Read before you start

1. This file: §6 (the loop), §7 (levers), §11 (research), and this section.
2. The routine "Quality: maintain Jev" (`07139640-2c30-435a-aef1-849101ab3461`): its prompt, and the
   reports of its runs since 2026-11-27.
3. PostHog project 411591: score definition `jev-single-responsibility-should-nudge`
   (`01a21506-a910-7481-b715-b0ae5e47798c`), dataset `jev-single-responsibility-real`
   (`01a21506-abe3-7d16-b877-3e6cdfa15fa8`), review queue `jev-unsure`
   (`01a21506-aee9-74dd-b7de-2f87c0fdc043`), and the offline experiments of suite
   `single-responsibility-real`.
4. `plugins/quality/README.md`, `evals/code-quality/AGENTS.md`, `quality-rules.md` §5.3 and §7.

### 12.3 Gates

| Gate                   | Number                                                                                                                            | Applies to                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Enough labels          | ≥ 300 labelled real scopes for SRP, about 2 weeks of runs (about 2026-12-09); ≥ 30 labelled `nudge`                               | start of S6                                      |
| Labels are trustworthy | labeller agreement ≥ 0.85 on real code                                                                                            | any precision claim; any new rule (gate 1 of §7) |
| Ship bar               | precision ≥ 0.95, Wilson 95% lower bound ≥ 0.85, inclusion-weighted recall ≥ 0.6, on a holdout of the real set that no tuning saw | S6, S7, S8 and any threshold change              |
| No regression          | SRP v2 matches or beats SRP v1 on the same real set, at the same precision bar                                                    | S6                                               |
| Product target         | ≥ 20 real (non-`probe/`) nudges per week across all policies, at the ship bar                                                     | the whole plan                                   |

Use weighted precision for any replay that changes a threshold: items from the random stratum
carry a weight of 1 / inclusion probability (§6.3).

### 12.4 The next slices

- **S5 (dashboard)** — done 2026-11-26, no code change. See §12.6.
- **S6 (SRP v2)** — §11.1. Split the real set into development and holdout by `path` family before
  any tuning. Compare with SRP v1 on both.
- **S7 (verifier)** — §11.3, after S6 passes.
- **S8 (next rule)** — §11.4 and §7. Gate 1 (agreement ≥ 0.85 on 30 real cases) before any eval run.

### 12.5 Known limits

- `thread_kind` is absent on events from a caller that cannot name the thread kind (#2972).
- From 2026-11-27 a tracked-debt finding notifies the agent once per episode, so the nudge text can say the mix
  predates the edit; the verdict is `debt_nudged`, `nudge_kind` separates these from new nudges, and the rubric
  labels a mix a nudge when the edit did not resolve it (decision: nudge debt when the agent is already in the file).
- `quality review unavailable` sends `bash_write` from 2026-11-26. It reads the command with the core
  command reader (`readCommand`, `deedsOf`), so a write that the reader cannot parse is not counted.
- The first labels: 5 trace reviews from a dry run on 2026-11-25 saw Jev's answer. Routine step 2.0
  re-labels them blind once.
- A turn can still run the previous deploy's code for about 2 minutes after Render reports the new
  deploy live (seen in the S3b live check). Check `atlas_version` on the events before you read a
  live check.

### 12.6 The S5 dashboard

"Jev quality" (https://us.posthog.com/project/411591/dashboard/2407147). Usefulness and accuracy are
separate groups. Every tile is a typed trends query, except the four that need SQL.

| Group            | Tile (short id)                                                       | Source                                                                        |
| ---------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Funnel, coverage | Funnel per day: writes to nudges (`PcwZKoVQ`), §5.4 #1                | `quality review completed`, `quality scope assessed`                          |
|                  | Reviews per day by status (`m6RqaH3U`)                                | `quality review completed`                                                    |
|                  | Skipped reviews by reason (`1VbnnbRJ`), by extension (`jqTreVak`), #2 | `skip_reason`, `extensions`                                                   |
|                  | Unavailable reviews by reason (`I7znKMS1`), #9                        | `quality review unavailable`                                                  |
| Latency, cost    | Oversized skips and review deadlines per hour (`Y6tf3fnR`)            | `skip_reasons`, `status`                                                      |
|                  | Scope build and classifier p50 / p95 per hour (`gJ1KBS7K`)            | `scope_build_ms`, `classifier_ms`                                             |
|                  | Classifier call latency and cost per day (`2XgJCw17`), #7             | `$ai_generation`                                                              |
|                  | Deadline rate (`7qGFpwQE`)                                            | `status`                                                                      |
| Scores, nudges   | Concern histogram per policy, per week (`DuvIgKcg`, SQL), #3          | `concern_score`                                                               |
|                  | Nudges per 100 scored scopes, no `probe/` (`g27dNKaF`, SQL), #4       | `verdict`; `path` from `$ai_generation`                                       |
|                  | Scope verdicts per day, not clean (`3Q5S5IQl`)                        | `verdict`                                                                     |
| Usefulness       | Nudge reactions, once per finding episode (`spcvRkAG`), #5            | `quality nudge reaction`: uniq(`finding_id`, `episode`)                       |
|                  | Finding lifecycle per week (`t3BAlJH6`)                               | nudged scopes, `quality finding resolved`, `quality finding closed`           |
| Accuracy         | Precision, Wilson lower bound, weighted recall (`X7k9Ut8U`, SQL), #6  | `system.trace_review_scores` on `$ai_trace_id` = `review_id`; dataset weights |
|                  | Label agreement rate per run (`My9c17PY`, SQL), #8                    | `system.trace_review_scores`: share not `unsure`                              |

The accuracy tile leaves out `unsure` labels and traces whose call was on a `probe/` path, and weights
recall by 1 / `inclusion_probability` from `jev-<policy>-real`. The old tiles that read
`quality example flagged`, `quality finding ignored` and `policies[].outcome` were removed or
rewritten.
