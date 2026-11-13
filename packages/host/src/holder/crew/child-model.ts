import type { ModelPort } from '@dltech/atlas-core'

import type { SessionRuntime } from '../ports'

export const childModelOf = (args: {
  runtime: Pick<SessionRuntime, 'modelChoice' | 'modelFor'>
  agentType: string
}): ModelPort =>
  args.runtime.modelFor({ role: { agentType: args.agentType }, root: args.runtime.modelChoice })
