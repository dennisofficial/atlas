import { ESubscriptionActor, ESubscriptionStatus, toThreadId } from '@dltech/atlas-core'
import type { Subscription } from '@dltech/atlas-core'
import {
  listSubscriptions,
  setSubscriptionStatus,
  subscribeTo,
  unsubscribeFrom,
  type RemoteDeltaChannel,
} from '@dltech/atlas-client/channel'
import {
  EMPTY_SUBSCRIPTIONS,
  ESubscriptionActorWire,
  ESubscriptionStatusWire,
  type SubscriptionRecordWire,
  type SubscriptionsWire,
} from '@dltech/atlas-wire'
import {
  SubscriptionRegistryPort,
  type SubscribeOutcome,
  type SubscriptionProviderInfo,
  type SubscriptionView,
} from '../subscriptions/port'

type SubscriptionChannel = Pick<
  RemoteDeltaChannel,
  'request' | 'onSubscriptions' | 'onReload' | 'onReady'
>

const ACTOR: Record<ESubscriptionActorWire, ESubscriptionActor> = {
  [ESubscriptionActorWire.Agent]: ESubscriptionActor.Agent,
  [ESubscriptionActorWire.Operator]: ESubscriptionActor.Operator,
  [ESubscriptionActorWire.Provider]: ESubscriptionActor.Provider,
  [ESubscriptionActorWire.Clock]: ESubscriptionActor.Clock,
}

const STATUS: Record<ESubscriptionStatusWire, ESubscriptionStatus> = {
  [ESubscriptionStatusWire.Active]: ESubscriptionStatus.Active,
  [ESubscriptionStatusWire.Paused]: ESubscriptionStatus.Paused,
}

const WIRE_STATUS: Record<ESubscriptionStatus, ESubscriptionStatusWire> = {
  [ESubscriptionStatus.Active]: ESubscriptionStatusWire.Active,
  [ESubscriptionStatus.Paused]: ESubscriptionStatusWire.Paused,
}

const NOT_RETURNED = 'The sandbox did not return the subscription'

const subscriptionOf = (record: SubscriptionRecordWire): Subscription => ({
  id: record.id,
  provider: record.provider,
  target: record.target,
  label: record.label,
  threadId: toThreadId(record.threadId),
  createdBy: ACTOR[record.createdBy],
  status: STATUS[record.status],
  expiresAt: record.expiresAt,
  createdAt: record.createdAt,
})

const viewsOf = (wire: SubscriptionsWire): readonly SubscriptionView[] =>
  Object.freeze(wire.subscriptions.map((row) => ({ ...subscriptionOf(row), held: row.held })))

export class RemoteSubscriptionRegistry extends SubscriptionRegistryPort {
  private held: SubscriptionsWire = EMPTY_SUBSCRIPTIONS
  private views: readonly SubscriptionView[] = []
  private revision = 0
  private readonly listeners = new Set<() => void>()
  private readonly detach: readonly (() => void)[]
  private disposed = false

  constructor(readonly channel: SubscriptionChannel) {
    super()
    this.detach = [
      channel.onSubscriptions((pushed) => this.accept(pushed)),
      channel.onReload(() => void this.refresh()),
      channel.onReady(() => void this.refresh()),
    ]
    void this.refresh()
  }

  dispose(): void {
    if (this.disposed) return

    this.disposed = true
    for (const off of this.detach) off()
    this.listeners.clear()
  }

  private accept(next: SubscriptionsWire): void {
    if (JSON.stringify(next) === JSON.stringify(this.held)) return

    this.held = next
    this.views = viewsOf(next)
    this.revision += 1
    for (const listener of [...this.listeners]) listener()
  }

  private async refresh(): Promise<void> {
    const listed = await listSubscriptions({ channel: this.channel }).catch(() => null)
    if (listed !== null && !this.disposed) this.accept(listed)
  }

  list(): readonly SubscriptionView[] {
    return this.views
  }

  providers(): readonly SubscriptionProviderInfo[] {
    return this.held.providers
  }

  async subscribe(
    args: Parameters<SubscriptionRegistryPort['subscribe']>[0],
  ): Promise<SubscribeOutcome> {
    const reply = await subscribeTo({
      channel: this.channel,
      threadId: args.threadId,
      provider: args.provider,
      input: args.input,
      expiresAt: args.expiresAt,
    })
    if (!reply.ok) return { ok: false, error: reply.error ?? NOT_RETURNED }
    if (reply.subscription === undefined) return { ok: false, error: NOT_RETURNED }

    return {
      ok: true,
      subscription: subscriptionOf(reply.subscription),
      existed: reply.existed === true,
    }
  }

  async setStatus(args: Parameters<SubscriptionRegistryPort['setStatus']>[0]): Promise<boolean> {
    const reply = await setSubscriptionStatus({
      channel: this.channel,
      subscriptionId: args.subscriptionId,
      status: WIRE_STATUS[args.status],
    })
    return reply.ok
  }

  async unsubscribe(
    args: Parameters<SubscriptionRegistryPort['unsubscribe']>[0],
  ): Promise<boolean> {
    const reply = await unsubscribeFrom({
      channel: this.channel,
      subscriptionId: args.subscriptionId,
    })
    return reply.ok
  }

  version(): number {
    return this.revision
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }
}
