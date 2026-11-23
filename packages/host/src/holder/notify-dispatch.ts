import type { ENotifyMoment, ThreadId } from '@dltech/atlas-core'

export type NotifyDispatchArgs = {
  sessionId: string
  threadId: ThreadId
  seq: number
  moment: ENotifyMoment
}

export type NotifyDispatch = (args: NotifyDispatchArgs) => Promise<void>
