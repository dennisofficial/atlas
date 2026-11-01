import {
  subscriptionsOf,
  type Event,
  type EventLogPort,
  type Subscription,
  type ThreadId,
} from '@dltech/atlas-core'

import { messageOf } from './provider-runs'

export class ThreadLoader {
  private readonly loaded = new Set<ThreadId>()
  private readonly loading = new Map<ThreadId, Promise<void>>()

  constructor(
    private readonly deps: {
      log: EventLogPort
      merge: (subscriptions: readonly Subscription[]) => void
      mergeEvents?: ((args: { threadId: ThreadId; events: readonly Event[] }) => void) | undefined
      warn: (message: string) => void
    },
  ) {}

  load({ threadId }: { threadId: ThreadId }): Promise<void> {
    if (this.loaded.has(threadId)) return Promise.resolve()

    const pending = this.loading.get(threadId)
    if (pending !== undefined) return pending

    const reading = this.read({ threadId }).finally(() => this.loading.delete(threadId))
    this.loading.set(threadId, reading)
    return reading
  }

  forget({ threadId }: { threadId: ThreadId }): void {
    this.loaded.delete(threadId)
    this.loading.delete(threadId)
  }

  async refresh({ threadId }: { threadId: ThreadId }): Promise<void> {
    await this.deps.log.refresh({ threadId }).catch(() => undefined)
    await this.load({ threadId })
  }

  private async read({ threadId }: { threadId: ThreadId }): Promise<void> {
    const events = await this.deps.log.readOwn({ threadId }).catch((cause: unknown) => {
      this.deps.warn(`could not read subscriptions of ${threadId}: ${messageOf(cause)}`)
      return null
    })
    if (events === null) return

    this.deps.merge(subscriptionsOf(events))
    this.deps.mergeEvents?.({ threadId, events })
    this.loaded.add(threadId)
  }
}
