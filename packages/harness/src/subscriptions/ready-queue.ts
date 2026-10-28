import type { EventDraft, ThreadId } from '@dltech/atlas-core'

import type { InputBatch } from '../intake/input-batch'
import type { IntakeSource } from '../intake/message-intake'

type Ready = { threadId: ThreadId; subscriptionId: string; draft: EventDraft }

const NOTHING: readonly Ready[] = Object.freeze([])

export class ReadyQueue {
  private queued: readonly Ready[] = NOTHING
  private noticed: ReadonlyMap<ThreadId, readonly Ready[]> = new Map()
  private readonly listeners = new Set<() => void>()

  enqueue({
    threadId,
    subscriptionId,
    drafts,
  }: {
    threadId: ThreadId
    subscriptionId: string
    drafts: readonly EventDraft[]
  }): void {
    this.settle([...this.queued, ...drafts.map((draft) => ({ threadId, subscriptionId, draft }))])
  }

  discard({ subscriptionId }: { subscriptionId: string }): void {
    const kept = this.queued.filter((ready) => ready.subscriptionId !== subscriptionId)
    if (kept.length !== this.queued.length) this.settle(kept)
  }

  prepare({ threadId }: { threadId: ThreadId }): InputBatch {
    const captured = this.queued.filter((ready) => ready.threadId === threadId)

    let acknowledged = false
    return {
      drafts: captured.map((ready) => ready.draft),
      wakesTurn: captured.length > 0,
      acknowledge: () => {
        if (acknowledged) return
        acknowledged = true
        const leaving = new Set(captured)
        const kept = this.queued.filter((ready) => !leaving.has(ready))
        if (kept.length !== this.queued.length) this.settle(kept)
      },
    }
  }

  pending({ threadId }: { threadId: ThreadId }): readonly Ready[] {
    return this.noticed.get(threadId) ?? NOTHING
  }

  threadsAwaiting(): readonly ThreadId[] {
    return [...this.noticed.keys()]
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private settle(queued: readonly Ready[]): void {
    this.queued = queued

    const byThread = new Map<ThreadId, Ready[]>()
    for (const ready of queued) {
      const held = byThread.get(ready.threadId)
      if (held === undefined) byThread.set(ready.threadId, [ready])
      else held.push(ready)
    }
    this.noticed = byThread

    for (const listener of [...this.listeners]) listener()
  }
}

export function readyIntakeSource({
  queue,
  load,
}: {
  queue: ReadyQueue
  load: (args: { threadId: ThreadId }) => Promise<void>
}): IntakeSource {
  return {
    prepare: async ({ threadId }) => {
      await load({ threadId })
      return queue.prepare({ threadId })
    },
    subscribe: (listener) => queue.onChange(listener),
    threadsAwaitingInput: () => queue.threadsAwaiting(),
    witness: ({ threadId }) => queue.pending({ threadId }),
  }
}
