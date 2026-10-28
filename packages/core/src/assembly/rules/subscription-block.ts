import { systemNotice } from '../../context/envelope'
import type { Event } from '../../events/envelope'
import {
  ESubscriptionActor,
  ESubscriptionEnd,
  ESubscriptionStatus,
} from '../../subscriptions/subscription'

export type SubscriptionLabels = Map<string, { label: string; provider: string }>

const ENDINGS: Readonly<Record<ESubscriptionEnd, string>> = {
  [ESubscriptionEnd.Unsubscribed]: 'removed by the operator',
  [ESubscriptionEnd.Expired]: 'expired',
  [ESubscriptionEnd.Completed]: 'completed',
}

const notice = (content: string): string => systemNotice({ kind: 'subscription', content })

const nameOf = ({ labels, id }: { labels: SubscriptionLabels; id: string }): string =>
  labels.get(id)?.label ?? id

export function subscriptionBlock({
  event,
  labels,
}: {
  event: Event
  labels: SubscriptionLabels
}): string | undefined {
  if (event.type === 'subscription-created') {
    labels.set(event.subscriptionId, { label: event.label, provider: event.provider })
    if (event.createdBy !== ESubscriptionActor.Operator) return undefined
    return notice(
      `The operator subscribed this thread to ${event.label} (${event.provider}), subscription ${event.subscriptionId}.`,
    )
  }

  if (event.type === 'subscription-changed') {
    if (event.by !== ESubscriptionActor.Operator) return undefined
    const verb = event.status === ESubscriptionStatus.Paused ? 'paused' : 'resumed'
    return notice(
      `The operator ${verb} ${nameOf({ labels, id: event.subscriptionId })}, subscription ${event.subscriptionId}.`,
    )
  }

  if (event.type === 'subscription-ended') {
    if (event.by === ESubscriptionActor.Agent) return undefined
    return notice(
      `Subscription ${event.subscriptionId} to ${nameOf({ labels, id: event.subscriptionId })} ended: ${ENDINGS[event.reason]}.`,
    )
  }

  return undefined
}
