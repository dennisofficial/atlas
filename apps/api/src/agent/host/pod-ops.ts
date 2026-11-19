import { CP_POD_OPS, ELiveOpFailure, type CallOp } from '@dltech/atlas-protocol'
import type {
  EventFrame,
  PodCallOutcome,
  RemoteCloseReason,
  SessionHolder,
} from '@dltech/atlas-host'

import { POD_OPS } from './tokens'

export { POD_OPS }

export const HOLDER_WAIT_MS = 10_000

export type PodOps = {
  invoke(args: {
    sessionId: string
    op: CallOp
    signal?: AbortSignal | undefined
    waitForHolder?: boolean | undefined
  }): Promise<PodCallOutcome>
  events(args: {
    sessionId: string
    listener: (frame: EventFrame) => void
    onClose?: ((reason: RemoteCloseReason) => void) | undefined
  }): (() => void) | null
  hold(args: { sessionId: string; ttlMs?: number | undefined }): boolean
  waitForHolder?(args: { sessionId: string; signal?: AbortSignal | undefined }): Promise<boolean>
}

export const podOpsOf = (args: {
  holder: Pick<SessionHolder, 'podCalls' | 'demandOf'>
}): PodOps => {
  const calls = args.holder.podCalls()
  const demand = args.holder.demandOf()
  const waitForHolder = (input: {
    sessionId: string
    signal?: AbortSignal | undefined
  }): Promise<boolean> =>
    demand.ensureHeld({
      sessionId: input.sessionId,
      timeoutMs: HOLDER_WAIT_MS,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
  return {
    invoke: async (input) => {
      if (!(CP_POD_OPS as readonly string[]).includes(input.op.op))
        return { state: 'unavailable', reason: ELiveOpFailure.Absent }
      if (input.waitForHolder === true && !(await waitForHolder(input)))
        return { state: 'unavailable', reason: ELiveOpFailure.Asleep }
      return calls.invoke(input)
    },
    events: (input) => calls.events(input),
    hold: (input) => {
      demand.panel.hold(input)
      return true
    },
    waitForHolder,
  }
}
