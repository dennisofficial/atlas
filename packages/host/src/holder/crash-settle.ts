import { ECrashedCall } from '@dltech/atlas-agent'
import { EToolEffect, type PendingCall } from '@dltech/atlas-core'

import { scopeKeyOf } from '../calls/call-scope'
import { recordedStepsOf } from './record/call-steps'
import type { SessionRecord } from './record/record-adapter'
import type { SessionRuntime } from './ports'

export const crashSettleOf = (args: {
  runtime: SessionRuntime
  record: Pick<SessionRecord, 'eventCache'>
  call: PendingCall
}): ECrashedCall => {
  if (args.runtime.daemonTools.has(args.call.name)) return ECrashedCall.Hold
  if (args.runtime.effectOf(args.call.name) === EToolEffect.Read) return ECrashedCall.Hold
  const scopeKey = scopeKeyOf({ runId: args.call.runId, callId: args.call.callId })
  if (recordedStepsOf({ record: args.record, scopeKey }).length > 0) return ECrashedCall.Hold
  const dispatched = args.record.eventCache().bookkeeping().findDispatched(args.call.callId)
  return dispatched?.bootId === undefined ? ECrashedCall.Interrupt : ECrashedCall.Hold
}
