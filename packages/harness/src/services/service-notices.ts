import type { EventDraft, ThreadId } from '@dltech/atlas-core'

import type { InputBatch } from '../intake/input-batch'
import { bootId } from './boot'
import { logTail, type ServiceSnapshot } from './service-process'

export const ENDING_TAIL_CHARACTERS = 4_000

export type ServiceNotice = { snapshot: ServiceSnapshot; threadId: ThreadId; draft: EventDraft }

export function serviceEndedDraft(args: { snapshot: ServiceSnapshot }): EventDraft {
  const { snapshot } = args

  return {
    type: 'service-ended',
    serviceId: snapshot.serviceId,
    command: snapshot.command,
    description: snapshot.description,
    bootId,
    status: snapshot.status,
    killedBy: snapshot.killedBy,
    exitCode: snapshot.exitCode,
    logPath: snapshot.logPath,
    tail: logTail({ path: snapshot.logPath, characters: ENDING_TAIL_CHARACTERS }),
  }
}

const NOTHING_PENDING: readonly ServiceNotice[] = Object.freeze([])

const NOTHING_ANNOUNCED: readonly ServiceSnapshot[] = Object.freeze([])

const NOTHING_DRAINED: readonly EventDraft[] = Object.freeze([])

const NOTHING_NOTICED: ReadonlyMap<ThreadId, readonly ServiceSnapshot[]> = new Map()

export class ServiceNoticeQueue {
  private queued: readonly ServiceNotice[] = NOTHING_PENDING
  private noticed: ReadonlyMap<ThreadId, readonly ServiceSnapshot[]> = NOTHING_NOTICED
  private readonly listeners = new Set<() => void>()
  private readonly logged: boolean

  constructor(args: { logged: boolean }) {
    this.logged = args.logged
  }

  queue(notice: ServiceNotice): void {
    this.settle([...this.queued, notice])
  }

  drain({ threadId }: { threadId: ThreadId }): readonly EventDraft[] {
    const batch = this.prepare({ threadId })
    batch.acknowledge()
    return batch.drafts
  }

  prepare({ threadId }: { threadId: ThreadId }): InputBatch {
    const captured = this.queued.filter((notice) => notice.threadId === threadId)
    const drafts = this.logged ? [] : captured.map((notice) => notice.draft)

    let acknowledged = false
    const acknowledge = (): void => {
      if (acknowledged) return
      acknowledged = true
      const leaving = new Set(captured)
      const kept = this.queued.filter((notice) => !leaving.has(notice))
      if (kept.length !== this.queued.length) this.settle(kept)
    }

    return { drafts, wakesTurn: captured.length > 0, acknowledge }
  }

  pending({ threadId }: { threadId: ThreadId }): readonly ServiceSnapshot[] {
    return this.noticed.get(threadId) ?? NOTHING_ANNOUNCED
  }

  threadsAwaiting(): readonly ThreadId[] {
    return [...this.noticed.keys()]
  }

  threadsQueued(): readonly ThreadId[] {
    return [...new Set(this.queued.map((notice) => notice.threadId))]
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

  /**
   * A finished child's leftovers move to the parent: the parent's next drain is the earliest
   * anyone alive can hear about them, and the child will never drain again.
   */
  reassign({ from, to }: { from: ThreadId; to: ThreadId }): void {
    if (from === to) return
    if (!this.queued.some((notice) => notice.threadId === from)) return

    this.settle(
      this.queued.map((notice) =>
        notice.threadId === from ? { ...notice, threadId: to } : notice,
      ),
    )
  }

  dropServices({ serviceIds }: { serviceIds: readonly string[] }): void {
    if (this.queued.length === 0 || serviceIds.length === 0) return
    this.settle(
      this.queued.filter((notice) => !serviceIds.includes(notice.snapshot.serviceId)),
    )
  }

  /**
   * The snapshots are held rather than derived per call: pending backs a React external store,
   * which reads it on every render and requires a stable value between changes.
   */
  private settle(notices: readonly ServiceNotice[]): void {
    this.queued = notices

    const byThread = new Map<ThreadId, ServiceSnapshot[]>()
    for (const notice of notices) {
      const held = byThread.get(notice.threadId)
      if (held === undefined) byThread.set(notice.threadId, [notice.snapshot])
      else held.push(notice.snapshot)
    }
    this.noticed = byThread

    for (const listener of [...this.listeners]) listener()
  }
}
