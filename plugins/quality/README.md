# @dltech/atlas-plugin-quality

The advisory code-quality review. After a successful file write or edit, the plugin asks the classifier role one set of calibrated questions per changed scope. It writes a `code-quality-reviewed` record per scope and gives the model one finding for the call. The plugin never blocks a write.

## Owns

- The `quality-review` afterTool hook: it asks the tool to capture the changed text, bounds the review at 1000 ms and returns the records and the finding.
- The review engine: scope preparation, policy selection, request planning and the size bounds.
- The budget: one deadline for a review, with a settlement grace for a cooperative classifier.
- The review records (`code-quality-reviewed`), the finding fold and the finding text.
- The coverage records: a skip, a retirement or a fault, each with its reason.
- The TypeScript source adapter: scopes, diffs, evidence labels and stable scope identity.
- The default policy registry: the single-responsibility policy and its settings key.

## Does not own

- `ClassifierPort`, `ClassifierQuestion`, `QualityScope`, the policy types and the event schema. `@dltech/atlas-core` owns them.
- The classifier's transports, model table and credential. `@dltech/atlas-classifier` owns them.
- The switch and the policy flags in storage. The caller passes `settings(ctx)`; `apps/api` reads the session settings.
- The clock. The caller passes `clock`, and the default is `Date.now`.
- Any storage. Records reach the event log through the drafts this plugin returns.
- The indicator line in a transcript. `@dltech/atlas-client` folds the records by call id.

## Entry points

| Import                             | Use it for                                                      |
| ---------------------------------- | --------------------------------------------------------------- |
| `@dltech/atlas-plugin-quality/pod` | `qualityPodOf(options)`, the hook, the engine and the registry. |

## Capabilities

The pod entry exports the first group only. The review modules below are the parts that this package uses inside itself.

### Build a pod slot

- `qualityPodOf({ settings, budgetMs, clock })`: makes the pod slot with the `quality-review` afterTool hook. `settings(ctx)` resolves `{ enabled, policies }` for the session.
- `QUALITY_REVIEW_BUDGET_MS`: the 1000 ms budget one review gets.
- `qualityReviewHook({ ctx, options })`: the hook itself, for a caller that composes the pod differently.

### Review a write

- `CodeQualityReview`: the engine. `review(args)` returns `{ records, context }`. `context` is the finding text, or `undefined` when the review missed the deadline or found nothing to tell the model.
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

## Plugin contributions

### Pod tier (`qualityPodOf`)

| Kind | Name             | What it adds                                                                          |
| ---- | ---------------- | ------------------------------------------------------------------------------------- |
| Hook | `quality-review` | afterTool, observe stage, nudge 20. Captures the changed text, then records a review. |

The hook asks for captured text only for a write or destructive call, while the classifier is on and the `quality.enabled` setting is true. When it asks for nothing, the tool captures nothing.

The hook returns the records as drafts, and the finding as a keyed `context-loaded` under the slot `quality-review`. The key is the call id, so a finding stays in the context and no later finding replaces it.

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

## See also

- [`docs/v2/slices/jev-quality.md`](../../docs/v2/slices/jev-quality.md) explains the design and the state it dropped.
- [`packages/core/src/quality`](../../packages/core/src/quality) holds the shared types and the policy logic.
