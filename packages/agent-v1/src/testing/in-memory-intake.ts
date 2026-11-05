import type { EventDraft, ThreadId } from '@dltech/atlas-core'

import type { AgentIntake } from '../intake/agent-intake'
import type { PendingDrain } from '../loop/pending-intake'

export class InMemoryIntake implements AgentIntake {
  private queue: { drafts: EventDraft[]; wakesTurn: boolean }[] = []
  private readonly listeners = new Set<() => void>()
  readonly acknowledged: (readonly EventDraft[])[] = []
  readonly released: (readonly EventDraft[])[] = []

  enqueue(args: { drafts: readonly EventDraft[]; wakesTurn?: boolean }): void {
    this.queue.push({ drafts: [...args.drafts], wakesTurn: args.wakesTurn ?? true })
    for (const listener of this.listeners) listener()
  }

  get pending(): number {
    return this.queue.length
  }

  prepare: AgentIntake['prepare'] = async (_args: {
    threadId: ThreadId
  }): Promise<PendingDrain> => {
    const taken = this.queue
    this.queue = []
    const drafts = taken.flatMap((entry) => entry.drafts)
    return {
      drafts,
      wakesTurn: taken.some((entry) => entry.wakesTurn),
      acknowledge: () => {
        this.acknowledged.push(drafts)
      },
      release: () => {
        this.released.push(drafts)
        this.queue = [...taken, ...this.queue]
      },
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
