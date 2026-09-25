import type { ClockPort, EventDraft, ThreadId } from '@dltech/atlas-core'

import type { AgentNotice, AgentNoticeQueue } from './notices'
import type { AgentRoster } from './roster'
import type { AgentSnapshot } from './snapshot'

export class NoticeDelivery {
  private readonly notices: AgentNoticeQueue
  private readonly roster: AgentRoster
  private readonly clock: ClockPort

  constructor(args: { notices: AgentNoticeQueue; roster: AgentRoster; clock: ClockPort }) {
    this.notices = args.notices
    this.roster = args.roster
    this.clock = args.clock
  }

  drain({ threadId }: { threadId: ThreadId }): readonly EventDraft[] {
    const handed = this.notices.pending({ threadId })
    const drafts = this.notices.drain({ threadId })
    this.stampDelivered(handed)
    return drafts
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

  private stampDelivered(handed: readonly AgentSnapshot[]): void {
    if (handed.length === 0) return

    const at = this.clock.now()
    let stamped = false

    for (const snapshot of handed) {
      const child = this.roster.find(snapshot.agentId)
      if (child === undefined || child.deliveredAt !== undefined) continue
      child.deliveredAt = at
      stamped = true
    }

    if (stamped) this.roster.changed()
  }
}
