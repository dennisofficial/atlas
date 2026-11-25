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

| Step                                         | Count | Share | Source                                      |
| -------------------------------------------- | ----- | ----- | ------------------------------------------- |
| Write tool calls with a captured file change | n/a   |       | not sent (gap G1)                           |
| Reviews recorded                             | 3,697 | 100%  | `quality review completed`                  |
| Skipped: `outside_workspace`                 | 649   | 17.6% | correct (routine run 1: context, `/tmp`)    |
| Skipped: `unsupported_language`              | 350   | 9.5%  | extension not sent (gap G2)                 |
| Skipped: `oversized_request`                 | 189   | 5.1%  | request over 24 KB / 48 KB                  |
| Skipped: `invalid_syntax`                    | 67    | 1.8%  |                                             |
| Skipped: other, deadline                     | 2     | 0.1%  | 1 `source_unavailable`, 1 `review_deadline` |
| Completed, no scope selected                 | 936   | 25.3% | module-only change, never sent to Jev       |
| Completed, at least one scope scored (SRP)   | 1,504 | 40.7% |                                             |
| Max concern ≥ 0.8                            | 9     | 0.24% | 5 `new_finding`, 4 `tracked_debt`           |
| Nudged                                       | 5     | 0.14% | 4 probes, 1 false positive                  |

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
5. Request bound: state + longest question ≤ 24 KB, state + all ≤ 48 KB
   (`plugins/quality/src/review/review-scopes.ts:17-18`).
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
- The regular capture limit is 1 MB per event. A Jev request is at most 48 KB.

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

1. **Sample** since the last run, from `quality scope assessed` and its `$ai_generation`:
   every nudge; every near-miss up to 20; 20 random from the rest. Record the stratum and the
   inclusion probability. Skip `code_withheld` calls.
2. **Label blind.** Two labeller sub-agents get only the path, before, after, diff and the rubric
   (`evals/code-quality/AGENTS.md`), not Jev's answer. When they agree, write the trace review.
   When they disagree, write `unsure` and put the trace in a review queue
   (`llma-review-queue-*`) for Dennis.
3. **Grow the set.** Add each agreed item to `jev-<policy>-real`.
4. **Measure.** Live precision, weighted recall and agreement (§6.3), in the report and the dashboard.
5. **Replay.** `bun run eval:jev-real --policy <id>` (new, `evals/code-quality`) loads the
   dataset through the PostHog API, runs the current classifier and thresholds, and publishes
   the run as an offline experiment with the pinned scorer version. This shows a threshold or rule
   change on all labelled real code, not only on new traffic.

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

Known false positive to fix at once with a general exception: a class whose shape a framework
fixes (migrations, framework entry classes). That is the 1 real nudge we have.

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
| S6  | After 2 weeks of labels: thresholds, module scope, framework-shape exception, first new rule                                                                              | S4         |

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

- Tracing the agent's own model calls, conversations or any session content.
- Reviewing `bash` writes. Only counted (§5.3).
- Online LLM-judge evaluations (they need a BYOK key and AI data approval).
- The dropped silent-failure and open/closed rules (`quality-rules.md` §7).
