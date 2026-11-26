import type { RunId, StepFact, ThreadId } from '@dltech/atlas-core'

import type { SessionRecord } from './record-adapter'

export const STEP_FACT_KIND = 'effect-started'

export type RecordedStep = StepFact & { bootId?: string | undefined }

export type StepRecord = { key: string; op: string; digest: string; bootId?: string | undefined }

const stepOf = (args: { key: string; value: unknown }): RecordedStep | undefined => {
  if (args.value === null || typeof args.value !== 'object') return undefined
  const value = args.value as { op?: unknown; digest?: unknown; bootId?: unknown }
  if (typeof value.op !== 'string' || typeof value.digest !== 'string') return undefined
  return {
    key: args.key,
    op: value.op,
    digest: value.digest,
    ...(typeof value.bootId === 'string' ? { bootId: value.bootId } : {}),
  }
}

export const recordedStepsOf = (args: {
  record: Pick<SessionRecord, 'eventCache'>
  scopeKey: string
}): readonly RecordedStep[] =>
  args.record
    .eventCache()
    .bookkeeping()
    .factsWithPrefix(`${args.scopeKey}.`)
    .flatMap((fact) => {
      if (fact.kind !== STEP_FACT_KIND) return []
      const step = stepOf({ key: fact.key, value: fact.value })
      return step === undefined ? [] : [step]
    })

export const recordStep = async (args: {
  record: Pick<SessionRecord, 'append'>
  threadId: ThreadId
  runId: RunId
  step: StepRecord
}): Promise<void> => {
  await args.record.append({
    threadId: args.threadId,
    runId: args.runId,
    drafts: [
      {
        type: 'fact-recorded',
        key: args.step.key,
        kind: STEP_FACT_KIND,
        value: {
          op: args.step.op,
          digest: args.step.digest,
          ...(args.step.bootId === undefined ? {} : { bootId: args.step.bootId }),
        },
      },
    ],
  })
}
