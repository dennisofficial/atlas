import { CP_POD_OPS, ELiveOpFailure, type CallOp } from '@dltech/atlas-protocol'
import type { PodCallOutcome, SessionHolder } from '@dltech/atlas-host'

export const POD_OPS = Symbol('POD_OPS')

export type PodOps = {
  invoke(args: {
    sessionId: string
    op: CallOp
    signal?: AbortSignal | undefined
  }): Promise<PodCallOutcome>
}

export const podOpsOf = (args: { holder: Pick<SessionHolder, 'podCalls'> }): PodOps => {
  const calls = args.holder.podCalls()
  return {
    invoke: (input) => {
      if (!(CP_POD_OPS as readonly string[]).includes(input.op.op))
        return Promise.resolve({ state: 'unavailable', reason: ELiveOpFailure.Absent })
      return calls.invoke(input)
    },
  }
}
