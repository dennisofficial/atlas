import {
  contextWindowOf,
  type EventDraft,
  type ModelStepResult,
  type ModelToolCall,
  type ModelTraits,
  type StepReading,
} from '@dltech/atlas-core'

const INTERRUPTED_BEFORE_RUNNING = 'the developer interrupted the turn before this tool ran'

const calledDraft = ({ call, ordinal }: { call: ModelToolCall; ordinal: number }): EventDraft => ({
  type: 'tool-called',
  callId: call.callId,
  name: call.name,
  input: call.input,
  ordinal,
})

export type StepDraftsArgs = {
  result: ModelStepResult
  model?: { traits?: () => ModelTraits } | undefined
}

const readingOf = ({ result, model }: StepDraftsArgs): StepReading | undefined => {
  if (result.usage === undefined) return undefined
  const contextWindow = model === undefined ? 0 : contextWindowOf(model)
  if (contextWindow <= 0) return result.usage
  return { ...result.usage, contextWindow }
}

const withStepUsage = ({
  drafts,
  step,
}: {
  drafts: EventDraft[]
  step: StepDraftsArgs
}): EventDraft[] => {
  const [first, ...rest] = drafts
  const usage = readingOf(step)
  if (usage === undefined || first === undefined) return drafts
  if (first.type !== 'assistant-said' && first.type !== 'tool-called') return drafts
  return [{ ...first, usage }, ...rest]
}

export function draftsFor(step: StepDraftsArgs): EventDraft[] {
  const { result } = step
  const drafts: EventDraft[] = []
  if (result.parts.length > 0)
    drafts.push({
      type: 'assistant-said',
      parts: result.parts,
      finish: result.finishReason,
      ...(result.ranFast === true ? { fast: true } : {}),
    })

  result.toolCalls.forEach((call, ordinal) => {
    drafts.push(calledDraft({ call, ordinal }))
  })

  return withStepUsage({ drafts, step })
}

export function interruptedDrafts(step: StepDraftsArgs): EventDraft[] {
  const { result } = step
  const drafts: EventDraft[] = []
  if (result.parts.length > 0)
    drafts.push({ type: 'assistant-said', parts: result.parts, interrupted: true })

  result.toolCalls.forEach((call, ordinal) => {
    drafts.push(calledDraft({ call, ordinal }))
    drafts.push({
      type: 'tool-denied',
      callId: call.callId,
      name: call.name,
      reason: INTERRUPTED_BEFORE_RUNNING,
      interrupted: true,
    })
  })

  return withStepUsage({ drafts, step })
}
