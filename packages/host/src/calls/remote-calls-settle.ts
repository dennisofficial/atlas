import { ECallFailure, type CallResult } from '@dltech/atlas-protocol'

import { failedResult, type Pending } from './remote-calls-frames'

export const settleCall = (args: {
  pending: Map<string, Pending>
  call: Pending
  result: CallResult
}): void => {
  if (args.call.done) return
  args.call.done = true
  args.pending.delete(args.call.key)
  args.call.detach?.()
  for (const waiter of args.call.waiters) waiter.settle(args.result)
}

export const settleFailed = (args: {
  pending: Map<string, Pending>
  call: Pending
  error: Error
}): void => {
  if (!args.call.ready) return
  settleCall({
    pending: args.pending,
    call: args.call,
    result: failedResult({
      op: args.call.op.op,
      code: ECallFailure.Internal,
      message: args.error.message,
    }),
  })
}
