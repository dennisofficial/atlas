import type { ENotifyMoment, NotifyDecision, ThreadId } from '@dltech/atlas-core'

export type NotifyDispatchArgs = {
  sessionId: string
  threadId: ThreadId
  seq: number
  moment: ENotifyMoment
  decision: NotifyDecision
  endedAt?: string
}

export type NotifyDispatch = (args: NotifyDispatchArgs) => Promise<void>
