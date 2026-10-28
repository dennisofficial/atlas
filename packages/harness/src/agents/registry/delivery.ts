import type { ClockPort, EventDraft, ThreadId } from '@dltech/atlas-core'

import type { InputBatch } from '../../intake/input-batch'
import { EAgentNotice, type AgentNotice, type AgentNoticeQueue } from './notices'
import type { AgentRoster } from './roster'

export type NoticeDrain = {
  drafts: readonly EventDraft[]
  /** False when every drained notice is bookkeeping the model never sees. */
  wakesTurn: boolean
}

export class NoticeDelivery {
  private readonly notices: AgentNoticeQueue
  private readonly roster: AgentRoster
  private readonly clock: ClockPort

  constructor(args: { notices: AgentNoticeQueue; roster: AgentRoster; clock: ClockPort }) {
    this.notices = args.notices
    this.roster = args.roster
    this.clock = args.clock
  }

  drain({ threadId }: { threadId: ThreadId }): NoticeDrain {
    const batch = this.prepareNotifications({ threadId })
    batch.acknowledge()
    return { drafts: batch.drafts, wakesTurn: batch.wakesTurn }
  }

  prepareNotifications({ threadId }: { threadId: ThreadId }): InputBatch {
    const prepared = this.notices.prepare({ threadId })
    return {
      drafts: prepared.drafts,
      wakesTurn: prepared.wakesTurn,
      acknowledge: () => {
        prepared.acknowledge()
        this.stampDelivered(prepared.notices)
      },
    }
  }

  /**
   * A relocation's flush, not a turn's delivery: only the arrival rows that never landed are
   * handed back to be written, and the notices stay queued as delivered-later so the parent still
   * hears them on its next turn.
   */
  flushArrivals({
    threadId,
    where,
  }: {
    threadId: ThreadId
    where: (notice: AgentNotice) => boolean
  }): readonly EventDraft[] {
    const flushed = this.notices.take({ threadId, where })
    for (const notice of flushed) this.notices.queue({ ...notice, unloggedArrival: undefined })
    return flushed.flatMap((notice) =>
      notice.unloggedArrival === undefined ? [] : [notice.unloggedArrival],
    )
  }

  discard({
    threadId,
    where,
  }: {
    threadId: ThreadId
    where: (notice: AgentNotice) => boolean
  }): void {
    this.notices.take({ threadId, where })
  }

  private stampDelivered(handed: readonly AgentNotice[]): void {
    const at = this.clock.now()
    let stamped = false

    for (const notice of handed) {
      if (notice.kind === EAgentNotice.Report) continue
      const child = this.roster.find(notice.snapshot.agentId)
      if (child === undefined || child.deliveredAt !== undefined || child.endedAt === undefined) {
        continue
      }
      if (notice.generation === undefined || child.abort.signal !== notice.generation) continue
      child.deliveredAt = at
      stamped = true
    }

    if (stamped) this.roster.changed()
  }
}
