import {
  EModelFallbackReason,
  refKey,
  type EventDraft,
  type ModelRef,
  type ThreadId,
} from '@dltech/atlas-core'

import type { SessionRuntime } from '../ports'

export const modelFellBackDraft = (args: {
  runtime: Pick<SessionRuntime, 'modelLabelOf'>
  role: string
  agentId: ThreadId
  from: ModelRef
  to: ModelRef
  reason: EModelFallbackReason
}): EventDraft => ({
  type: 'model-fell-back',
  role: args.role,
  agentId: args.agentId,
  from: { ref: refKey(args.from), label: args.runtime.modelLabelOf(args.from) },
  to: { ref: refKey(args.to), label: args.runtime.modelLabelOf(args.to) },
  reason: args.reason,
})
