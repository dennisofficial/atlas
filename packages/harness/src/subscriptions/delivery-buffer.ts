import type { EventDraft } from '@dltech/atlas-core'

import { EOccurrenceUrgency, type SubscriptionOccurrence } from './provider'

export const QUIET_WINDOW_MS = 120_000

export type Schedule = (args: { ms: number; run: () => void }) => () => void

export type Delivery = { subscriptionId: string; drafts: readonly EventDraft[] }

type Hold = { drafts: Map<string, EventDraft>; cancel: () => void }

export class DeliveryBuffer {
  private readonly holds = new Map<string, Hold>()

  constructor(
    private readonly args: {
      schedule: Schedule
      isLive: (subscriptionId: string) => boolean
      deliver: (delivery: Delivery) => void
      quietWindowMs?: number | undefined
    },
  ) {}

  offer({
    subscriptionId,
    occurrence,
  }: {
    subscriptionId: string
    occurrence: SubscriptionOccurrence
  }): void {
    if (!this.args.isLive(subscriptionId)) return

    const flushes =
      occurrence.urgency === EOccurrenceUrgency.Now ||
      occurrence.settles === true ||
      occurrence.ends === true
    if (!flushes) {
      this.hold({ subscriptionId, occurrence })
      return
    }

    const carried = [...(this.holds.get(subscriptionId)?.drafts ?? [])]
      .filter(([key]) => key !== occurrence.key)
      .map(([, draft]) => draft)
    this.drop({ subscriptionId })
    this.args.deliver({ subscriptionId, drafts: [...carried, occurrence.draft] })
  }

  heldCount({ subscriptionId }: { subscriptionId: string }): number {
    return this.holds.get(subscriptionId)?.drafts.size ?? 0
  }

  drop({ subscriptionId }: { subscriptionId: string }): void {
    this.holds.get(subscriptionId)?.cancel()
    this.holds.delete(subscriptionId)
  }

  dispose(): void {
    for (const subscriptionId of [...this.holds.keys()]) this.drop({ subscriptionId })
  }

  private hold({
    subscriptionId,
    occurrence,
  }: {
    subscriptionId: string
    occurrence: SubscriptionOccurrence
  }): void {
    const held = this.holds.get(subscriptionId)
    held?.cancel()

    const drafts = held?.drafts ?? new Map<string, EventDraft>()
    drafts.delete(occurrence.key)
    drafts.set(occurrence.key, occurrence.draft)

    const cancel = this.args.schedule({
      ms: this.args.quietWindowMs ?? QUIET_WINDOW_MS,
      run: () => this.flush({ subscriptionId }),
    })
    this.holds.set(subscriptionId, { drafts, cancel })
  }

  private flush({ subscriptionId }: { subscriptionId: string }): void {
    const drafts = [...(this.holds.get(subscriptionId)?.drafts.values() ?? [])]
    this.holds.delete(subscriptionId)
    if (drafts.length > 0) this.args.deliver({ subscriptionId, drafts })
  }
}
