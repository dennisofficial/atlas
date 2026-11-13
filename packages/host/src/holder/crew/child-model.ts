import { refKey, type ModelPort, type ModelRef } from '@dltech/atlas-core'

import type { RoleModelChoice, SessionRuntime } from '../ports'
import { childFallbackModel } from './child-fallback-model'

export type ChildModelRuntime = Pick<
  SessionRuntime,
  'modelChoice' | 'modelFor' | 'choiceFor' | 'model' | 'normalizeFailure'
>

export const childChoiceOf = (args: {
  runtime: Pick<SessionRuntime, 'modelChoice' | 'choiceFor'>
  agentType: string
}): RoleModelChoice =>
  args.runtime.choiceFor({ role: { agentType: args.agentType }, root: args.runtime.modelChoice })

export const childModelOf = (args: {
  runtime: ChildModelRuntime
  agentType: string
  onFallback?: ((refs: { from: ModelRef; to: ModelRef }) => void | Promise<void>) | undefined
}): ModelPort => {
  const choice = childChoiceOf(args)
  const primary = args.runtime.modelFor({
    role: { agentType: args.agentType },
    root: args.runtime.modelChoice,
  })
  const to = args.runtime.modelChoice.ref
  if (refKey(choice.ref) === refKey(to) || args.onFallback === undefined) return primary
  return childFallbackModel({
    primary,
    main: args.runtime.model,
    normalizeFailure: args.runtime.normalizeFailure,
    onFallback: () => args.onFallback?.({ from: choice.ref, to }),
  })
}
