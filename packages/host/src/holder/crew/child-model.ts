import { refKey, type ModelPort, type ModelRef } from '@dltech/atlas-core'

import type { RoleModelChoice, SessionRuntime } from '../ports'
import { childFallbackModel } from './child-fallback-model'

export type ChildModelRuntime = Pick<
  SessionRuntime,
  'modelChoice' | 'modelOf' | 'model' | 'normalizeFailure'
>

export const childChoiceOf = (args: {
  runtime: Pick<SessionRuntime, 'modelChoice' | 'choiceFor'>
  agentType: string
}): RoleModelChoice =>
  args.runtime.choiceFor({ role: { agentType: args.agentType }, root: args.runtime.modelChoice })

export const childModelOf = (args: {
  runtime: ChildModelRuntime
  model: RoleModelChoice
  onFallback?: ((refs: { from: ModelRef; to: ModelRef }) => void | Promise<void>) | undefined
}): ModelPort => {
  const primary = args.runtime.modelOf(args.model)
  const to = args.runtime.modelChoice.ref
  if (refKey(args.model.ref) === refKey(to) || args.onFallback === undefined) return primary
  return childFallbackModel({
    primary,
    main: args.runtime.model,
    normalizeFailure: args.runtime.normalizeFailure,
    onFallback: () => args.onFallback?.({ from: args.model.ref, to }),
  })
}
