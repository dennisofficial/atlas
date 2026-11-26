import { planStep } from '@dltech/atlas-core'

import {
  claimStepSlot,
  noStepKey,
  rememberRecordedSteps,
  scopeConsumedKeys,
  scopeKey,
  scopeNextSlot,
  scopeRecordedSteps,
} from '../calls/call-scope'
import { stepDigestOf } from '../calls/step-digest'
import type { RecordedStep, StepRecord } from './record/call-steps'

export const EFFECT_RESULT_KIND = 'effect-result'

export type EffectResultLookup<T> = { found: true; value: T } | { found: false }

export type HostStepFacts = {
  recorded(scopeKey: string): readonly RecordedStep[]
  record(step: StepRecord): Promise<void>
  result<T>(stepKey: string): EffectResultLookup<T>
  recordResult(stepKey: string, value: unknown): Promise<void>
}

export const effectResultKeyOf = (stepKey: string): string => `${EFFECT_RESULT_KIND}:${stepKey}`

const rememberHostStep = (args: { recorded: readonly RecordedStep[]; step: StepRecord }): void => {
  rememberRecordedSteps([
    ...args.recorded,
    {
      key: args.step.key,
      op: args.step.op,
      digest: args.step.digest,
      ...(args.step.bootId === undefined ? {} : { bootId: args.step.bootId }),
    },
  ])
}

export const runHostStep = async <T>(args: {
  facts: HostStepFacts
  op: string
  input: unknown
  identity?: unknown
  run: (key: string, replayed?: boolean) => Promise<T>
}): Promise<T> => {
  const scope = scopeKey()
  if (scope === undefined) return await args.run(noStepKey(), false)
  const recorded = scopeRecordedSteps() ?? (await args.facts.recorded(scope))
  rememberRecordedSteps(recorded)
  const digest = stepDigestOf({ op: args.op, input: args.identity ?? args.input })
  const plan = planStep({
    scopeKey: scope,
    recorded,
    consumed: scopeConsumedKeys() ?? new Set<string>(),
    op: args.op,
    digest,
    nextSlot: scopeNextSlot(),
  })
  claimStepSlot({ key: plan.key, index: plan.index })
  if (plan.kind === 'reuse') {
    const known = args.facts.result<T>(plan.key)
    if (known.found) return known.value
    const replayed = await args.run(plan.key, true)
    await args.facts.recordResult(plan.key, replayed)
    return replayed
  }
  const step: StepRecord = { key: plan.key, op: args.op, digest }
  await args.facts.record(step)
  rememberHostStep({ recorded, step })
  const value = await args.run(plan.key, false)
  await args.facts.recordResult(plan.key, value)
  return value
}
