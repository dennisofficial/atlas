import type { ENotifyMoment, NotifyDecision, ThreadId } from '@dltech/atlas-core'

export type NotifyDispatchArgs = {
  sessionId: string
  threadId: ThreadId
  seq: number
  moment: ENotifyMoment
  decision: NotifyDecision
}

export type NotifyDispatch = (args: NotifyDispatchArgs) => Promise<void>
