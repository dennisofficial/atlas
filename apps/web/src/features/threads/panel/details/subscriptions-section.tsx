'use client'

import { Trash2Icon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Switch } from '@dltech/atlas-ui/components/switch'
import { ESubscriptionStatusWire, type SubscriptionWire } from '@dltech/atlas-wire/web'

import { detailOf } from '../../data/subscription-model'
import { useNow } from '../../data/use-now'
import type { SubscriptionsData } from '../../data/use-subscriptions'
import { DetailsSection } from './section'

function SubscriptionRow(props: {
  subscription: SubscriptionWire
  now: number
  busy: boolean
  onPausedChange: (paused: boolean) => void
  onRemove: () => void
}) {
  const { subscription, now, busy } = props
  const active = subscription.status === ESubscriptionStatusWire.Active
  return (
    <div className="flex items-center gap-2 px-1 py-0.5" data-status={subscription.status}>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-sm">{subscription.label}</span>
        <span className="truncate text-xs text-muted-foreground">
          {active ? null : <span className="font-medium">Paused · </span>}
          {detailOf({ subscription, now })}
        </span>
      </div>
      <Switch
        size="sm"
        checked={active}
        disabled={busy}
        aria-label={`${active ? 'Pause' : 'Resume'} ${subscription.label}`}
        onCheckedChange={(checked) => props.onPausedChange(!checked)}
      />
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={busy}
        aria-label={`Remove ${subscription.label}`}
        className="text-muted-foreground"
        onClick={props.onRemove}
      >
        <Trash2Icon />
      </Button>
    </div>
  )
}

export function SubscriptionsSection(props: { data: SubscriptionsData }) {
  const { subscriptions, busy, setPaused, remove } = props.data
  const now = useNow(subscriptions.some((subscription) => subscription.expiresAt !== undefined))
  if (subscriptions.length === 0) return null

  return (
    <DetailsSection title="Subscriptions" count={subscriptions.length}>
      {subscriptions.map((subscription) => (
        <SubscriptionRow
          key={subscription.id}
          subscription={subscription}
          now={now}
          busy={busy.has(subscription.id)}
          onPausedChange={(paused) => setPaused({ subscriptionId: subscription.id, paused })}
          onRemove={() => remove(subscription.id)}
        />
      ))}
    </DetailsSection>
  )
}
