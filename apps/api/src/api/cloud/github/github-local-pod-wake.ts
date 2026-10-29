import { db } from '@dltech/atlas-db'
import type { GithubPrFanoutService } from './github-pr-fanout.service'

export const LOCAL_WAKE_BURST_MS = 30_000

type LinkedSubscription = { threadId: string; liveUntil: Date }

/**
 * A local pod runs on the operator's machine, so the API cannot boot it: it tells the user's
 * running TUIs which thread to wake, and only a TUI showing that thread acts on it. One frame per
 * thread per burst, claimed synchronously so concurrent lookups for the same burst push once.
 */
export class LocalPodWakes {
  private readonly lastPushedAt = new Map<string, number>()

  constructor(private readonly fanout: GithubPrFanoutService) {}

  async push(args: {
    userId: string
    subscriptions: readonly LinkedSubscription[]
    cloudThreadIds: ReadonlySet<string>
  }): Promise<void> {
    const now = Date.now()
    const live = args.subscriptions.filter(
      (subscription) =>
        subscription.liveUntil.getTime() > now && !args.cloudThreadIds.has(subscription.threadId),
    )
    if (live.length === 0) return
    const leased = await db.orm.public.LocalPodLease.where({ userId: args.userId })
      .where((lease) => lease.threadId.in(live.map((subscription) => subscription.threadId)))
      .select('threadId')
      .all()
    for (const { threadId } of leased) {
      const last = this.lastPushedAt.get(threadId)
      if (last !== undefined && Date.now() - last < LOCAL_WAKE_BURST_MS) continue
      this.lastPushedAt.set(threadId, Date.now())
      this.fanout.pushWake({ userIds: [args.userId], threadId })
    }
  }
}
