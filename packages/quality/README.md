# @dltech/atlas-quality

The advisory code-quality review. After a successful file write, this package asks the classifier
role one set of calibrated questions per changed scope, folds the answers into a finding ledger and
produces the review records plus one one-time nudge. The host builds it from a `ClassifierPort`.

## Owns

- The review engine: scope preparation, policy selection, request planning and the size bounds.
- The budget: one deadline for a review, with a settlement grace for a cooperative classifier.
- The review records (`code-quality-reviewed`), the finding fold and the consolidated nudge text.
- The coverage records: a skip, a retirement or a fault, each with its reason.
- The TypeScript source adapter: scopes, diffs, evidence labels and stable scope identity.
- The default policy registry: the single-responsibility policy and its settings key.

## Does not own

- `ClassifierPort`, `ClassifierQuestion`, `QualityScope`, the policy types and the event schema.
  `@dltech/atlas-core` owns them.
- The classifier's transports, model table and credential. `@dltech/atlas-classifier` owns them.
- Reading settings, the clock and the workspace identity. The caller injects each one.
- The workspace identity probe itself. `@dltech/atlas-host` owns the git probe and its port.
- Any storage. Records reach the event log through the drafts this package returns.

## Entry points

| Import                  | Use it for                                                                     |
| ----------------------- | ------------------------------------------------------------------------------ |
| `@dltech/atlas-quality` | The engine, the deadline helpers, the source adapter and the default registry. |

## Capabilities

### Review a write

- `CodeQualityReview`: a core `QualityReviewPort`. `captureEnabled()` reads the switch, and
  `review(args)` returns the record drafts and at most one nudge draft.
- `CodeQualityReviewDeps`: the classifier, its requested model, the source adapter, the registry,
  the settings accessor, the workspace identity port, the clock and the deadline in milliseconds.
- `qualitySwitches({ values })`: the `enabled` switch and the boolean policy flags of a setting map.
- `QUALITY_POLICIES`, `qualityRegistry`: the default registry, which holds the
  single-responsibility policy.

### Bound a review

- `createQualityBudget({ signal, budgetMs, now })`: a signal that aborts with `QualityDeadlineError`
  at the budget, its absolute `deadlineAt` and a `dispose`.
- `settleUnderBudget({ signal, work })`, `settleReview({ budget, work, graceMs })`: settle the work
  as completed, deadline, aborted or failed.
- `deadlineErrorOf(signal)`: the deadline error of an aborted signal, if that is why it aborted.
- `QUALITY_SETTLEMENT_GRACE_MS`: the grace a cooperative review gets after the budget.

### Prepare the changed scopes

- `prepareQualityScopes({ change, projectDirectory, workspaceNamespace, previousScopes })`: the
  changed scopes of one captured file, plus the diagnostics that stopped a scope.
- `MAX_STATE_AND_LONGEST_QUESTION_BYTES`, `MAX_STATE_AND_ALL_QUESTIONS_BYTES`: the request bounds.
- `QualitySourceAdapter`: the one method the engine calls to get the scopes of a change.
- `captureText`, `makeChange`, `captureUnavailableFault`: text capture with its diagnostics.
- `parseQualitySource`, `scriptKindForPath`, `hashScopeText`, `renderScopeDiff`: the parser helpers.

### Read a review back

- `qualityReviewsOf(event)`: the review records of one event, standalone or on a tool result.

### The workspace identity deadline

- `WorkspaceIdentityDeadlineError`, `WORKSPACE_IDENTITY_TIMEOUT_MS`: the error and the 750 ms bound a
  host's identity probe throws and uses.

## Usage

```ts
import { CodeQualityReview, qualityRegistry } from '@dltech/atlas-quality'

const engine = new CodeQualityReview({
  classifier,
  requestedModel: classifierStatus.model,
  source: { prepareQualityScopes },
  registry: qualityRegistry,
  settings: readOf(settings),
  workspaceIdentity,
  clock: Date.now,
  deadlineMs: 1000,
})

const drafts = await engine.review({
  call,
  runId,
  changes,
  captureFaults,
  events,
  projectDirectory,
  signal,
})
```

## Rules

- This package imports `@dltech/atlas-core`, `typescript`, `node:path` and `node:crypto` only. The
  purity guard and the split guard enforce it.
- The caller injects the clock and the deadline. This package reads no clock of its own.
- The review is advisory. It never blocks, reverts or retries a write, and a skipped, late or
  inconclusive review says nothing to the model.
- Call `captureEnabled()` before you capture source text. When it is false, the review reads nothing.

## See also

- `docs/v2/slices/jev-quality.md` explains the design and the state it dropped.
