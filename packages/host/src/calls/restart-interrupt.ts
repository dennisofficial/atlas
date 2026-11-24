import { ECallFailure } from '@dltech/atlas-protocol'
import type { CallResult } from '@dltech/atlas-protocol'

import { resizeInterruptedMessage } from './errors'
import { failedResult, type Pending } from './remote-calls-frames'

export const resizeInterruptedResult = (args: { op: string; reason: string }): CallResult =>
  failedResult({
    op: args.op,
    code: ECallFailure.Interrupted,
    message: resizeInterruptedMessage({ reason: args.reason }),
  })

export const interruptPendingForResize = (args: {
  pending: ReadonlyMap<string, Pending>
  reason: string
  cancel(call: Pending): void
  settle(call: Pending, result: CallResult): void
}): void => {
  for (const call of [...args.pending.values()]) {
    if (call.done) continue
    args.cancel(call)
    args.settle(call, resizeInterruptedResult({ op: call.op.op, reason: args.reason }))
  }
}
