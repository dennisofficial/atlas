import type { ClockPort, EventDraft, ThreadId } from '@dltech/atlas-core'

import { EAgentNotice, isTurnTakingNotice, type AgentNotice, type AgentNoticeQueue } from './notices'
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
    const handed = this.notices.take({ threadId, where: () => true })
    this.stampDelivered(handed)
    return {
      drafts: handed.map((notice) => notice.draft),
      wakesTurn: handed.some(isTurnTakingNotice),
    }
  }

  /**
   * A relocation's flush, not a turn's delivery: terminal endings travel with the log, while the
   * snapshots stay pending so the parent still hears the ending on its next turn.
   */
  drainEndings({
    threadId,
    where,
  }: {
    threadId: ThreadId
    where: (notice: AgentNotice) => boolean
  }): readonly EventDraft[] {
    return this.notices.take({ threadId, where }).map((notice) => notice.draft)
  }

  private stampDelivered(handed: readonly AgentNotice[]): void {
    const at = this.clock.now()
    let stamped = false

    for (const notice of handed) {
      if (notice.kind === EAgentNotice.Report) continue
      const child = this.roster.find(notice.snapshot.agentId)
      if (child === undefined || child.deliveredAt !== undefined) continue
      child.deliveredAt = at
      stamped = true
    }

    if (stamped) this.roster.changed()
  }
}
