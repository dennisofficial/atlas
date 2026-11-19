import { CP_POD_OPS, ELiveOpFailure, type CallOp } from '@dltech/atlas-protocol'
import type {
  EventFrame,
  PodCallOutcome,
  RemoteCloseReason,
  SessionHolder,
} from '@dltech/atlas-host'

import { POD_OPS } from './tokens'

export { POD_OPS }

export type PodOps = {
  invoke(args: {
    sessionId: string
    op: CallOp
    signal?: AbortSignal | undefined
  }): Promise<PodCallOutcome>
  events(args: {
    sessionId: string
    listener: (frame: EventFrame) => void
    onClose?: ((reason: RemoteCloseReason) => void) | undefined
  }): (() => void) | null
}

export const podOpsOf = (args: { holder: Pick<SessionHolder, 'podCalls'> }): PodOps => {
  const calls = args.holder.podCalls()
  return {
    invoke: (input) => {
      if (!(CP_POD_OPS as readonly string[]).includes(input.op.op))
        return Promise.resolve({ state: 'unavailable', reason: ELiveOpFailure.Absent })
      return calls.invoke(input)
    },
    events: (input) => calls.events(input),
  }
}
