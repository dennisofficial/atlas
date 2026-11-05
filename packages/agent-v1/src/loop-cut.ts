import type { EventDraft, ThreadId } from '@dltech/atlas-core'

export type ApplyLoopCut = (args: {
  threadId: ThreadId
  toSeq: number
  throughSeq: number
  notice: EventDraft
}) => Promise<boolean>
