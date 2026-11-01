'use client'

import { Trash2Icon } from 'lucide-react'

import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'
import { Button } from '@dltech/atlas-ui/components/button'
import { Switch } from '@dltech/atlas-ui/components/switch'
import { ESubscriptionStatusWire, type SubscriptionWire } from '@dltech/atlas-wire/web'

import { detailOf } from '../../data/subscription-model'
import { useNow } from '../../data/use-now'
import type { SubscriptionsData } from '../../data/use-subscriptions'
import { DetailsSection } from './section'

export type SubscriptionTeammate = { id: string; title: string }

function SubscriptionRow(props: {
  subscription: SubscriptionWire
  now: number
  busy: boolean
  teammateTitles: ReadonlyMap<string, string>
  onPausedChange: (paused: boolean) => void
  onRemove: () => void
}) {
  const { subscription, now, busy, teammateTitles } = props
  const active = subscription.status === ESubscriptionStatusWire.Active
  const via = teammateTitles.get(subscription.threadId)
  return (
    <DetailRow
      mono
      label={subscription.label}
      detail={
        <>
          {via === undefined ? null : <span className="font-medium">via {via} · </span>}
          {active ? null : <span className="font-medium">Paused · </span>}
          {detailOf({ subscription, now })}
        </>
      }
      actions={
        <>
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
        </>
      }
    />
  )
}

export function SubscriptionsSection(props: {
  data: SubscriptionsData
  teammates?: readonly SubscriptionTeammate[]
}) {
  const { subscriptions, busy, setPaused, remove } = props.data
  const now = useNow(subscriptions.some((subscription) => subscription.expiresAt !== undefined))
  const teammateTitles = new Map(
    (props.teammates ?? []).map((teammate) => [teammate.id, teammate.title]),
  )
  if (subscriptions.length === 0) return null

  return (
    <DetailsSection title="Subscriptions" count={subscriptions.length}>
      {subscriptions.map((subscription) => (
        <SubscriptionRow
          key={subscription.id}
          subscription={subscription}
          now={now}
          busy={busy.has(subscription.id)}
          teammateTitles={teammateTitles}
          onPausedChange={(paused) => setPaused({ subscriptionId: subscription.id, paused })}
          onRemove={() => remove(subscription.id)}
        />
      ))}
    </DetailsSection>
  )
}
