import { CP_POD_OPS, ELiveOpFailure, type CallOp } from '@dltech/atlas-protocol'
import {
  EPodReach,
  type EventFrame,
  type PodCallOutcome,
  type PodFollowClose,
  type SessionHolder,
} from '@dltech/atlas-host'

import { POD_OPS } from './tokens'

export { POD_OPS }

export type PodOps = {
  invoke(args: {
    sessionId: string
    op: CallOp
    signal?: AbortSignal | undefined
    waitForHolder?: boolean | undefined
  }): Promise<PodCallOutcome>
  follow(args: {
    sessionId: string
    listener: (frame: EventFrame) => void
    onClose?: ((reason: PodFollowClose) => void) | undefined
    signal?: AbortSignal | undefined
  }): Promise<(() => void) | null>
  events(args: {
    sessionId: string
    listener: (frame: EventFrame) => void
    onClose?: ((reason: PodFollowClose) => void) | undefined
  }): (() => void) | null
  hold(args: { sessionId: string; ttlMs?: number | undefined }): boolean
  servesLocally(args: { sessionId: string; signal?: AbortSignal | undefined }): Promise<boolean>
}

export const podOpsOf = (args: {
  holder: Pick<SessionHolder, 'podCalls' | 'demandOf' | 'podRouter'>
}): PodOps => {
  const calls = args.holder.podCalls()
  const demand = args.holder.demandOf()
  const router = args.holder.podRouter()
  return {
    invoke: async (input) => {
      if (!(CP_POD_OPS as readonly string[]).includes(input.op.op))
        return { state: 'unavailable', reason: ELiveOpFailure.Absent }
      return router.invoke(input)
    },
    follow: (input) => router.follow(input),
    events: (input) => calls.events(input),
    hold: (input) => demand.holdPanel(input),
    servesLocally: async (input) =>
      (await router.reach({ sessionId: input.sessionId, signal: input.signal })).kind ===
      EPodReach.Local,
  }
}
