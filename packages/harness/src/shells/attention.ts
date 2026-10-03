import type { ThreadId } from '@dltech/atlas-core'

import type { ShellSnapshot } from './background-shell'

export enum ENotice {
  Ended = 'ended',
  AwaitingInput = 'awaiting-input',
  Matched = 'matched',
}

export type PendingShellNotice = { kind: ENotice; snapshot: ShellSnapshot }
export type ShellAttention = PendingShellNotice & { threadId: ThreadId }

const EMPTY: readonly PendingShellNotice[] = Object.freeze([])

export class ShellAttentionQueue {
  private queued: readonly ShellAttention[] = []
  private noticed: ReadonlyMap<ThreadId, readonly PendingShellNotice[]> = new Map()
  private readonly listeners = new Set<() => void>()

  queue(notice: ShellAttention): void {
    this.settle([...this.queued, notice])
  }

  prepare({ threadId }: { threadId: ThreadId }) {
    const captured = this.queued.filter((notice) => notice.threadId === threadId)
    let acknowledged = false
    return {
      drafts: [],
      wakesTurn: captured.length > 0,
      acknowledge: () => {
        if (acknowledged) return
        acknowledged = true
        const leaving = new Set(captured)
        const kept = this.queued.filter((notice) => !leaving.has(notice))
        if (kept.length !== this.queued.length) this.settle(kept)
      },
    }
  }

  pending({ threadId }: { threadId: ThreadId }): readonly PendingShellNotice[] {
    return this.noticed.get(threadId) ?? EMPTY
  }

  dropShells(args: { threadId: ThreadId; shellIds: readonly string[] }): void {
    this.settle(this.queued.filter((notice) =>
      notice.threadId !== args.threadId || !args.shellIds.includes(notice.snapshot.shellId),
    ))
  }

  threadsAwaiting(): readonly ThreadId[] {
    return [...this.noticed.keys()]
  }

  threadsQueued(): readonly ThreadId[] {
    return this.threadsAwaiting()
  }

  onNotice(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  forget({ threadId }: { threadId: ThreadId }): void {
    this.settle(this.queued.filter((notice) => notice.threadId !== threadId))
  }

  private settle(notices: readonly ShellAttention[]): void {
    this.queued = notices
    const byThread = new Map<ThreadId, PendingShellNotice[]>()
    for (const notice of notices) {
      const pending = { kind: notice.kind, snapshot: notice.snapshot }
      const held = byThread.get(notice.threadId)
      if (held === undefined) byThread.set(notice.threadId, [pending])
      else held.push(pending)
    }
    this.noticed = byThread
    for (const listener of [...this.listeners]) listener()
  }
}
