import type { EventDraft, ThreadId } from '@dltech/atlas-core'

import type { InputBatch } from '../../intake/input-batch'
import type { IntakeSource } from '../../intake/message-intake'

export type PrEventNotice = { threadId: ThreadId; draft: EventDraft }

const NOTHING_PENDING: readonly PrEventNotice[] = Object.freeze([])

const NOTHING_NOTICED: ReadonlyMap<ThreadId, readonly PrEventNotice[]> = new Map()

export class PrEventNoticeQueue {
  private queued: readonly PrEventNotice[] = NOTHING_PENDING
  private noticed: ReadonlyMap<ThreadId, readonly PrEventNotice[]> = NOTHING_NOTICED
  private readonly listeners = new Set<() => void>()

  queue(notice: PrEventNotice): void {
    this.settle([...this.queued, notice])
  }

  prepare({ threadId }: { threadId: ThreadId }): InputBatch {
    const captured = this.queued.filter((notice) => notice.threadId === threadId)

    let acknowledged = false
    const acknowledge = (): void => {
      if (acknowledged) return
      acknowledged = true
      const leaving = new Set(captured)
      const kept = this.queued.filter((notice) => !leaving.has(notice))
      if (kept.length !== this.queued.length) this.settle(kept)
    }

    return {
      drafts: captured.map((notice) => notice.draft),
      wakesTurn: captured.length > 0,
      acknowledge,
    }
  }

  drain({ threadId }: { threadId: ThreadId }): readonly EventDraft[] {
    const batch = this.prepare({ threadId })
    batch.acknowledge()
    return batch.drafts
  }

  pending({ threadId }: { threadId: ThreadId }): readonly PrEventNotice[] {
    return this.noticed.get(threadId) ?? NOTHING_PENDING
  }

  threadsAwaiting(): readonly ThreadId[] {
    return [...this.noticed.keys()]
  }

  onNotice(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  forget({ threadId }: { threadId: ThreadId }): void {
    const kept = this.queued.filter((notice) => notice.threadId !== threadId)
    if (kept.length === this.queued.length) return

    this.settle(kept)
  }

  reassign({ from, to }: { from: ThreadId; to: ThreadId }): void {
    if (from === to) return
    if (!this.queued.some((notice) => notice.threadId === from)) return

    this.settle(
      this.queued.map((notice) => (notice.threadId === from ? { ...notice, threadId: to } : notice)),
    )
  }

  /** `pending` backs the intake witness, which compares by reference, so it is held rather than derived per call. */
  private settle(notices: readonly PrEventNotice[]): void {
    this.queued = notices

    const byThread = new Map<ThreadId, PrEventNotice[]>()
    for (const notice of notices) {
      const held = byThread.get(notice.threadId)
      if (held === undefined) byThread.set(notice.threadId, [notice])
      else held.push(notice)
    }
    this.noticed = byThread

    for (const listener of [...this.listeners]) listener()
  }
}

export function prEventIntakeSource(queue: PrEventNoticeQueue): IntakeSource {
  return {
    prepare: ({ threadId }) => queue.prepare({ threadId }),
    subscribe: (listener) => queue.onNotice(listener),
    threadsAwaitingInput: () => queue.threadsAwaiting(),
    witness: ({ threadId }) => queue.pending({ threadId }),
  }
}
