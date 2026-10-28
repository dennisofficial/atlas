import {
  ESubscriptionEnd,
  ESubscriptionStatus,
  type Subscription,
  type ThreadId,
} from '@dltech/atlas-core'

import type { IntakeSource } from '../intake/message-intake'
import { ChangeNotifier, Serial } from './change-notifier'
import { DeliveryBuffer } from './delivery-buffer'
import {
  SubscriptionRegistryPort,
  type SubscribeOutcome,
  type SubscriptionProviderInfo,
  type SubscriptionView,
} from './port'
import { COMPLETED, EXPIRED, newSubscriptionId, SubscriptionJournal, type Ending } from './journal'
import { ProviderRuns } from './provider-runs'
import type { SubscriptionOccurrence, SubscriptionProvider } from './provider'
import { findExisting, resolveRequest } from './resolve-request'
import { ThreadLoader } from './thread-loader'
import type { SubscriptionRegistryDeps } from './registry-deps'
import { readyIntakeSource, ReadyQueue } from './ready-queue'

export class SubscriptionRegistry extends SubscriptionRegistryPort {
  readonly intakeSource: IntakeSource

  private readonly providerByKind: ReadonlyMap<string, SubscriptionProvider>
  private readonly subscriptions = new Map<string, Subscription>()
  private readonly loader: ThreadLoader
  private readonly runs: ProviderRuns
  private readonly ending = new Set<string>()
  private readonly queue = new ReadyQueue(({ subscriptionId }) =>
    this.finishAfterDelivery({ subscriptionId }),
  )
  private readonly buffer: DeliveryBuffer
  private readonly journal: SubscriptionJournal
  private readonly notifier = new ChangeNotifier()
  private readonly serial = new Serial()
  private disposed = false

  constructor(private readonly deps: SubscriptionRegistryDeps) {
    super()
    this.providerByKind = new Map(deps.providers.map((provider) => [provider.kind, provider]))
    this.journal = new SubscriptionJournal({
      log: deps.log,
      ids: deps.ids,
      warn: (message) => this.warn(message),
    })
    this.loader = new ThreadLoader({
      log: deps.log,
      merge: (found) => {
        for (const subscription of found) {
          if (!this.subscriptions.has(subscription.id))
            this.subscriptions.set(subscription.id, subscription)
        }
        this.reconcile()
        this.changed()
      },
      warn: (message) => this.warn(message),
    })
    this.runs = new ProviderRuns({
      providers: this.providerByKind,
      subscriptions: () =>
        [...this.subscriptions.values()].filter(
          (subscription) => !this.ending.has(subscription.id),
        ),
      offer: (offered) => this.offer(offered),
      expire: ({ subscriptionId }) => this.expire({ subscriptionId }),
      schedule: deps.schedule,
      now: deps.now,
      warn: (message) => this.warn(message),
    })
    this.buffer = new DeliveryBuffer({
      schedule: deps.schedule,
      isLive: (subscriptionId) => this.isLive(subscriptionId),
      deliver: ({ subscriptionId, drafts }) => {
        const subscription = this.subscriptions.get(subscriptionId)
        if (subscription === undefined) return
        this.queue.enqueue({ threadId: subscription.threadId, subscriptionId, drafts })
        this.changed()
      },
    })
    this.intakeSource = readyIntakeSource({
      queue: this.queue,
      load: ({ threadId }) => this.load({ threadId }),
    })
  }

  list(): readonly SubscriptionView[] {
    return [...this.subscriptions.values()].map((subscription) => ({
      ...subscription,
      held: this.buffer.heldCount({ subscriptionId: subscription.id }),
    }))
  }

  providers(): readonly SubscriptionProviderInfo[] {
    return this.deps.providers.map(({ kind, summary, targetHint }) => ({
      kind,
      summary,
      targetHint,
    }))
  }

  version(): number {
    return this.notifier.version()
  }

  onChange(listener: () => void): () => void {
    return this.notifier.subscribe(listener)
  }

  load({ threadId }: { threadId: ThreadId }): Promise<void> {
    return this.loader.load({ threadId })
  }

  async reload({ threadId }: { threadId: ThreadId }): Promise<void> {
    for (const subscription of [...this.subscriptions.values()]) {
      if (subscription.threadId !== threadId) continue
      this.ending.delete(subscription.id)
      this.subscriptions.delete(subscription.id)
      this.discardPending(subscription.id)
    }
    this.loader.forget({ threadId })
    this.reconcile()
    this.changed()
    await this.loader.refresh({ threadId })
  }

  subscribe(args: Parameters<SubscriptionRegistryPort['subscribe']>[0]): Promise<SubscribeOutcome> {
    return this.serial.run(() => this.subscribeNow(args))
  }

  setStatus(args: Parameters<SubscriptionRegistryPort['setStatus']>[0]): Promise<boolean> {
    return this.serial.run(() => this.changeStatus(args))
  }

  unsubscribe({
    subscriptionId,
    by,
  }: Parameters<SubscriptionRegistryPort['unsubscribe']>[0]): Promise<boolean> {
    return this.serial.run(() =>
      this.end({ id: subscriptionId, reason: ESubscriptionEnd.Unsubscribed, by, keepReady: false }),
    )
  }

  dispose(): void {
    this.disposed = true
    for (const subscriptionId of [...this.ending]) this.finish({ id: subscriptionId, ...COMPLETED })
    this.runs.dispose()
    this.buffer.dispose()
    this.notifier.clear()
  }

  private async subscribeNow(
    args: Parameters<SubscriptionRegistryPort['subscribe']>[0],
  ): Promise<SubscribeOutcome> {
    const request = await resolveRequest({
      providers: this.providerByKind,
      owners: this.deps.owners,
      request: args,
    })
    if ('error' in request) return { ok: false, error: request.error }

    const { provider, owner, resolved } = request
    await this.load({ threadId: owner })

    const existing = findExisting({
      subscriptions: this.subscriptions.values(),
      owner,
      provider: provider.kind,
      target: resolved.target,
    })
    if (existing !== undefined) {
      if (existing.status === ESubscriptionStatus.Paused) {
        await this.changeStatus({
          subscriptionId: existing.id,
          status: ESubscriptionStatus.Active,
          by: args.by,
        })
      }
      return {
        ok: true,
        subscription: this.subscriptions.get(existing.id) ?? existing,
        existed: true,
      }
    }

    const created = await this.journal.created({
      owner,
      fields: {
        subscriptionId: (this.deps.newId ?? newSubscriptionId)(),
        provider: provider.kind,
        target: resolved.target,
        label: resolved.label,
        createdBy: args.by,
        expiresAt: args.expiresAt,
      },
    })
    if ('error' in created) return { ok: false, error: created.error }

    this.subscriptions.set(created.id, created)
    this.reconcile()
    this.changed()
    return { ok: true, subscription: created, existed: false }
  }

  private async changeStatus(
    args: Parameters<SubscriptionRegistryPort['setStatus']>[0],
  ): Promise<boolean> {
    const subscription = this.subscriptions.get(args.subscriptionId)
    if (subscription === undefined) return false
    if (subscription.status === args.status) return true

    const recorded = await this.journal.changed({
      subscription,
      status: args.status,
      by: args.by,
    })
    if (!recorded) return false

    this.subscriptions.set(subscription.id, { ...subscription, status: args.status })
    if (args.status !== ESubscriptionStatus.Active) this.discardPending(subscription.id)
    this.reconcile()
    this.changed()
    return true
  }

  private async end({ id, reason, by, keepReady }: Ending): Promise<boolean> {
    const subscription = this.subscriptions.get(id)
    if (subscription === undefined) return false

    const recorded = await this.journal.ended({ subscription, reason, by })
    this.ending.delete(id)
    if (!recorded) return false

    this.subscriptions.delete(id)
    this.buffer.drop({ subscriptionId: id })
    if (!keepReady) this.queue.discard({ subscriptionId: id })
    this.reconcile()
    this.changed()
    return true
  }

  private offer({
    subscriptionId,
    occurrence,
  }: {
    subscriptionId: string
    occurrence: SubscriptionOccurrence
  }): void {
    if (!this.isLive(subscriptionId)) return

    this.buffer.offer({ subscriptionId, occurrence })
    this.changed()
    if (occurrence.ends !== true) return

    this.ending.add(subscriptionId)
    this.reconcile()
  }

  private finishAfterDelivery({ subscriptionId }: { subscriptionId: string }): void {
    if (!this.ending.has(subscriptionId) || this.queue.holds({ subscriptionId })) return
    this.finish({ id: subscriptionId, ...COMPLETED })
  }

  private expire({ subscriptionId }: { subscriptionId: string }): void {
    this.finish({ id: subscriptionId, ...EXPIRED })
  }

  private finish(ending: Ending): void {
    void this.serial.run(() => this.end(ending))
  }

  private isLive(subscriptionId: string): boolean {
    return (
      this.subscriptions.get(subscriptionId)?.status === ESubscriptionStatus.Active &&
      !this.ending.has(subscriptionId)
    )
  }

  private discardPending(subscriptionId: string): void {
    this.buffer.drop({ subscriptionId })
    this.queue.discard({ subscriptionId })
  }

  private reconcile(): void {
    if (!this.disposed) this.runs.reconcile()
  }

  private changed(): void {
    this.notifier.notify()
  }

  private warn(message: string): void {
    this.deps.warn?.(message)
  }
}
