import type { CallId, CapturedFileChange, RunId, ThreadId } from '@dltech/atlas-core'

import { settleUnderBudget } from './deadline'
import { EXAMPLE_SCHEMA_VERSION, type QualityExampleSink } from './example-sink'
import type { ScopeSelection } from './review-scopes'

export type ExampleOutcome = { path?: string; fault?: string }

export async function recordSelectedExamples({
  sink,
  selections,
  change,
  provenance,
  workspaceNamespace,
  signal,
}: {
  sink: Pick<QualityExampleSink, 'record'>
  selections: readonly ScopeSelection[]
  change: CapturedFileChange
  provenance: { threadId: ThreadId; runId: RunId; callId: CallId; toolName: string }
  workspaceNamespace: string
  signal: AbortSignal
}): Promise<Map<string, ExampleOutcome>> {
  const recorded = await settleUnderBudget({
    signal,
    work: () =>
      Promise.all(
        selections.map(({ scope, policies }) =>
          sink.record({
            ...provenance,
            scope,
            change,
            workspaceNamespace,
            policyIds: policies.map((policy) => policy.id),
            policyVersions: Object.fromEntries(policies.map((policy) => [policy.id, policy.version])),
            adapterVersion: scope.adapterVersion,
            schemaVersion: EXAMPLE_SCHEMA_VERSION,
          }),
        ),
      ),
  })

  const outcomes = new Map<string, ExampleOutcome>()
  selections.forEach(({ scope }, index) => {
    const result = recorded.kind === 'completed' ? recorded.value[index] : undefined
    if (result === undefined) outcomes.set(scope.id, { fault: `example recording did not finish (${recorded.kind})` })
    else outcomes.set(scope.id, result.ok ? { path: result.relativePath } : { fault: result.fault })
  })
  return outcomes
}
