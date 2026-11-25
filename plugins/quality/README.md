# @dltech/atlas-plugin-quality

The advisory code-quality review. After a successful file write or edit, the plugin asks the classifier role one set of calibrated questions per changed scope. It writes a `code-quality-reviewed` record per scope and gives the model one note per reviewed file. The plugin never blocks a write.

## Owns

- The `quality-review` afterTool hook: it asks the tool to capture the changed text, bounds the review at 1000 ms and returns the records and the finding.
- The `quality-finding-ignored` afterTurn hook: it reports, from the log alone, each finding the model was nudged about and left active.
- The product events `quality review completed`, `quality finding resolved`, `quality finding closed` and `quality finding ignored`. `resolved` means the classifier saw the problem go away. `closed` means a nudged finding ended because a later write removed its scope (deleted, moved or renamed with a changed body), so the log cannot tell a fix from a move.
- The review engine: scope preparation, policy selection, request planning and the size bounds.
- The budget: one deadline for a review, with a settlement grace for a cooperative classifier.
- The review records (`code-quality-reviewed`), the finding fold and the per-file note text.
- The coverage records: a skip, a retirement or a fault, each with its reason.
- The TypeScript source adapter: scopes, diffs, evidence labels and stable scope identity.
- The default policy registry: the single-responsibility policy and its settings key.
- The single-responsibility policy itself: its descriptor, scope selection, its three questions, their
  interpretation and its coaching text. The policy is split across `src/policies/single-responsibility`.
- The question request and answer interpretation that every policy shares: `prepareQualityRequest`,
  `interpretQualityResponse` and their size bounds.
- The finding ledger: the episode table, its transitions and the fold from records.
- The indicator notice a surface draws on a reviewed tool call: `qualityNoticeOf`, `qualityNoticeLine`
  and `EQualityNoticeTone`.

## Does not own

- `ClassifierPort`, `ClassifierQuestion`, `QualityScope`, the policy types and the event schema. `@dltech/atlas-core` owns them.
- The classifier's transports, model table and credential. `@dltech/atlas-classifier` owns them.
- The switch and the policy flags in storage. The caller passes `settings(ctx)`; `apps/api` reads the session settings.
- The clock. The caller passes `clock`, and the default is `Date.now`.
- Any storage. Records reach the event log through the drafts this plugin returns.
- The transcript row itself. `@dltech/atlas-client` folds the records by call id onto the call;
  this plugin only turns that fold into a label.

## Entry points

| Import                                | Use it for                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `@dltech/atlas-plugin-quality/pod`    | `qualityPodOf(options)`, the hook, the engine and the registry.            |
| `@dltech/atlas-plugin-quality/core`   | Pure data for surfaces: the policy descriptors and the indicator notice.   |
| `@dltech/atlas-plugin-quality/review` | The engine, the policies, the request and the ledger, for evals and specs. |

## Capabilities

The pod entry exports the first group only. The review modules below are the parts that this package uses inside itself.

### Build a pod slot

- `qualityPodOf({ settings, budgetMs, clock })`: makes the pod slot with the `quality-review` afterTool hook. `settings(ctx)` resolves `{ enabled, policies, examples }` for the session.
- `QUALITY_REVIEW_BUDGET_MS`: the 1000 ms budget one review gets.
- `qualityReviewHook({ ctx, options })`: the hook itself, for a caller that composes the pod differently.
- `qualityIgnoredHook({ ctx })`: the afterTurn hook that reports the findings a turn left active.

### Review a write

- `CodeQualityReview`: the engine. `review(args)` returns `{ records, flagged, notes, timings, language, inputTokens }`. `records` holds the review records. `flagged` holds one `{ record, entry }` for each finding that produces an advisory note. `notes` holds one `{ key, content }` per reviewed file, keyed by the workspace-relative path; the list is empty when the review missed the deadline or found nothing to tell the model. `timings` splits the scope build and the classifier calls; `inputTokens` is the classifier usage the provider reported.
- `CodeQualityReviewDeps`: the classifier, its requested model, the source adapter, the registry, the settings accessor, the clock and the deadline in milliseconds.
- `qualitySwitches({ values })`: the `enabled` switch and the boolean policy flags of a setting map.
- `QUALITY_POLICIES`, `qualityRegistry`: the default registry, which holds the single-responsibility policy.

### Bound a review

- `createQualityBudget({ signal, budgetMs, now })`: a signal that aborts with `QualityDeadlineError` at the budget, its absolute `deadlineAt` and a `dispose`.
- `settleUnderBudget({ signal, work })`, `settleReview({ budget, work, graceMs })`: settle the work as completed, deadline, aborted or failed.
- `deadlineErrorOf(signal)`: the deadline error of an aborted signal, if that is why it aborted.
- `QUALITY_SETTLEMENT_GRACE_MS`: the grace a cooperative review gets after the budget.

### Prepare the changed scopes

- `prepareQualityScopes({ change, projectDirectory, workspaceNamespace, previousScopes })`: the changed scopes of one captured file, plus the diagnostics that stopped a scope.
- `MAX_STATE_AND_LONGEST_QUESTION_BYTES`, `MAX_STATE_AND_ALL_QUESTIONS_BYTES`: the request bounds.
- `QualitySourceAdapter`: the one method the engine calls to get the scopes of a change.
- `captureText`, `makeChange`, `captureUnavailableFault`: text capture with its diagnostics.
- `parseQualitySource`, `scriptKindForPath`, `hashScopeText`, `renderScopeDiff`: the parser helpers.

### Read a review back

- `qualityReviewsOf(event)`: the review records of one event, standalone or on a tool result.

### Draw the indicator (the `./core` entry)

- `QUALITY_POLICY_DESCRIPTORS`: `id`, `version`, `title`, `description`, `settingKey` and
  `defaultEnabled` for each policy, with no engine behind them.
- `qualityNoticeOf(reviews)`, `qualityNoticeLine(notice)`, `EQualityNoticeTone`, `QualityNotice` and
  `QualityNoticeLine`: the one-line indicator a tool row draws, and the failure wording for a review
  that missed its budget or could not decide.

The `./core` entry imports `@dltech/atlas-core` and the policy modules only. It has no engine and
no TypeScript compiler.

## Plugin contributions

### Pod tier (`qualityPodOf`)

| Kind | Name                      | What it adds                                                                          |
| ---- | ------------------------- | ------------------------------------------------------------------------------------- |
| Hook | `quality-review`          | afterTool, observe stage, nudge 20. Captures the changed text, then records a review. |
| Hook | `quality-finding-ignored` | afterTurn, observe stage, nudge 20. Reports the findings the turn left active.        |

The hooks send product events through `ctx.analytics` with ids, enums, numbers and booleans only:
`status`, `skip_reason`, `policy_ids`, `policies` (`policy_id`, `outcome`, `max_confidence`), `files`,
`notified`, `classifier_model`, `classifier_provider`, `scope_build_ms`, `classifier_ms`, `total_ms`,
`input_tokens`, `language`, `first_review_in_session`, and for a finding `policy_id`,
`steps_after_nudge` and `turns_after_nudge`. The host adds `session_id` and `thread_id`.
The "Jev quality" PostHog dashboard reads them: https://us.posthog.com/project/411591/dashboard/2407147.

The one exception is `quality example flagged`, which carries code text. The hook sends it once for
each finding that produces the advisory note, and only when the settings say `examples`, which the
API turns on for a session owner on the `ATLAS_QUALITY_EXAMPLE_USERS` allowlist (comma separated,
empty by default). Its properties are `policy_id`, `policy_version`, `status`, `impact`,
`transition`, `concern_score`, `finding_id`, `episode`, `path` (relative to the project directory),
`scope_name`, `scope_kind`, `language`, `line_start`, `line_end`, `excerpt`, `excerpt_truncated` and
`classifier_model`. The excerpt is the scope's after text cut to 4000 characters, and
`excerpt_truncated` says when it was cut. The hook sends nothing when the path is secret shaped
(`.env`, keys, `.ssh`) or the excerpt names a secret literal.

The hook asks for captured text only for a call with the `write` effect, while the classifier is on and the `quality.enabled` setting is true. When it asks for nothing, the tool captures nothing.

The hook returns the records as drafts, and each note as a `context-loaded` under the slot `quality-review`, keyed by the reviewed file path. A later review of the same file replaces its note; a review that finds nothing left to say about a file writes an empty note for that key, so the earlier note leaves the prompt. A file whose earlier note is current and whose review found a new problem keeps the note: one finding is told once.

## Usage

```ts
import { qualityPodOf } from '@dltech/atlas-plugin-quality/pod'

const qualityPod = qualityPodOf({
  settings: async (ctx) => await qualitySettings.settings(ctx.sessionId),
})
```

## Rules

- The workspace namespace is the `projectDirectory` of the after-tool hook. The plugin runs no `git` command, and a directory outside a repository is still reviewed.
- The review is advisory. It never blocks, reverts or retries a write. A skipped, late or inconclusive review says nothing to the model.
- A late review still writes its records, so the ledger stays complete, and it gives the model no finding.
- A sub-agent and a teammate get the same afterTool hooks as the main agent, so their writes are reviewed too. No extra wiring is necessary.
- The hook budget is 5 s, above the 1 s review deadline, so the hook returns its own deadline record.
- Import `@dltech/atlas-plugin-quality/pod` in the pod only. It imports `@dltech/atlas-agent`, `@dltech/atlas-core`, `@dltech/atlas-plugin-sdk`, `typescript`, `node:path` and `node:crypto`, and the guards enforce it.
- `@dltech/atlas-plugin-quality/core` stays pure: `@dltech/atlas-core` and the policy modules only.
  A surface, a settings page or the agent's config may import it; nothing else in the engine is public
  to them.
- Evals import the plugin through `@dltech/atlas-plugin-quality/review` only.

## See also

- [`docs/slices/jev-quality.md`](../../docs/slices/jev-quality.md) explains the design and the state it dropped.
- [`packages/core/src/quality`](../../packages/core/src/quality) holds the shared types and the record schema.
