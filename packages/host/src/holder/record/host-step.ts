import { planStep, type RunId, type ThreadId } from '@dltech/atlas-core'

import {
  claimStepSlot,
  rememberRecordedSteps,
  scopeConsumedKeys,
  scopeKey,
  scopeNextSlot,
  scopeRecordedSteps,
} from '../../calls/call-scope'
import { stepDigestOf } from '../../calls/step-digest'
import { recordStep, recordedStepsOf } from './call-steps'
import type { SessionRecord } from './record-adapter'

export type HostStep = { key: string; replayed: boolean }

export const hostStepOf = async (args: {
  record: Pick<SessionRecord, 'append' | 'eventCache'>
  threadId: ThreadId
  runId: () => RunId
  op: string
  input: object
}): Promise<HostStep | undefined> => {
  const scope = scopeKey()
  if (scope === undefined) return undefined
  const recorded = scopeRecordedSteps() ?? recordedStepsOf({ record: args.record, scopeKey: scope })
  rememberRecordedSteps(recorded)
  const digest = stepDigestOf({ ...args.input, op: args.op })
  const plan = planStep({
    scopeKey: scope,
    recorded,
    consumed: scopeConsumedKeys() ?? new Set<string>(),
    op: args.op,
    digest,
    nextSlot: scopeNextSlot(),
  })
  claimStepSlot({ key: plan.key, index: plan.index })
  if (plan.kind === 'reuse') return { key: plan.key, replayed: true }
  await recordStep({
    record: args.record,
    threadId: args.threadId,
    runId: args.runId(),
    step: { key: plan.key, op: args.op, digest },
  })
  return { key: plan.key, replayed: false }
}
