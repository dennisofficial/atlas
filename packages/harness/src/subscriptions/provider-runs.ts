import { ESubscriptionStatus, type Subscription } from '@dltech/atlas-core'

import type { Schedule } from './delivery-buffer'
import type { SubscriptionOccurrence, SubscriptionProvider } from './provider'

export const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

export class ProviderRuns {
  private readonly running = new Map<string, () => void>()
  private readonly expiries = new Map<string, () => void>()

  constructor(
    private readonly args: {
      providers: ReadonlyMap<string, SubscriptionProvider>
      subscriptions: () => Iterable<Subscription>
      offer: (args: { subscriptionId: string; occurrence: SubscriptionOccurrence }) => void
      expire: (args: { subscriptionId: string }) => void
      schedule: Schedule
      now: () => number
      warn: (message: string) => void
    },
  ) {}

  reconcile(): void {
    const live = new Map<string, Subscription>()
    for (const subscription of this.args.subscriptions()) live.set(subscription.id, subscription)

    for (const [id, stop] of [...this.running]) {
      if (live.get(id)?.status === ESubscriptionStatus.Active) continue
      this.running.delete(id)
      this.stop(stop)
    }
    for (const [id, cancel] of [...this.expiries]) {
      if (live.has(id)) continue
      this.expiries.delete(id)
      cancel()
    }

    for (const subscription of live.values()) {
      if (subscription.status === ESubscriptionStatus.Active && !this.running.has(subscription.id))
        this.start(subscription)
      if (subscription.expiresAt !== undefined && !this.expiries.has(subscription.id))
        this.scheduleExpiry({ id: subscription.id, expiresAt: subscription.expiresAt })
    }
  }

  dispose(): void {
    for (const stop of this.running.values()) this.stop(stop)
    for (const cancel of this.expiries.values()) cancel()
    this.running.clear()
    this.expiries.clear()
  }

  private start(subscription: Subscription): void {
    const provider = this.args.providers.get(subscription.provider)
    if (provider === undefined) {
      this.args.warn(`no provider "${subscription.provider}" is installed for ${subscription.id}`)
      return
    }

    try {
      const stop = provider.start({
        subscription,
        emit: (occurrence) => this.args.offer({ subscriptionId: subscription.id, occurrence }),
      })
      this.running.set(subscription.id, stop)
    } catch (cause) {
      this.args.warn(
        `provider "${provider.kind}" could not start ${subscription.id}: ${messageOf(cause)}`,
      )
    }
  }

  private stop(stop: () => void): void {
    try {
      stop()
    } catch (cause) {
      this.args.warn(`a subscription provider threw while stopping: ${messageOf(cause)}`)
    }
  }

  private scheduleExpiry({ id, expiresAt }: { id: string; expiresAt: string }): void {
    const at = Date.parse(expiresAt)
    if (Number.isNaN(at)) return

    const cancel = this.args.schedule(Math.max(0, at - this.args.now()), () => {
      this.expiries.delete(id)
      this.args.expire({ subscriptionId: id })
    })
    this.expiries.set(id, cancel)
  }
}
