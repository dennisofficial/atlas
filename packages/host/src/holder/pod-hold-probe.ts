import type { PodHoldProbe } from '@dltech/atlas-agent'

import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

export const podHoldProbeOf = (args: {
  runtime: SessionRuntime
  record: SessionRecord
}): PodHoldProbe => ({
  dispatchedBootId: (callId) =>
    args.record.eventCache().bookkeeping().findDispatched(callId)?.bootId ?? undefined,
  podAnswer: (call) =>
    args.runtime.remoteCalls.podAnswerFor({ runId: call.runId, callId: call.callId }),
  daemonBootId: () => args.runtime.remoteCalls.bootId(),
})
