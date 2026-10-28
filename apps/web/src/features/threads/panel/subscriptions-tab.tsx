'use client'

import { BellIcon, Trash2Icon, WifiOffIcon } from 'lucide-react'

import { SUBSCRIPTIONS_TOO_OLD } from '@dltech/atlas-client/channel'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@dltech/atlas-ui/components/item'
import { Spinner } from '@dltech/atlas-ui/components/spinner'
import { Switch } from '@dltech/atlas-ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'
import { ESubscriptionStatusWire, type SubscriptionWire } from '@dltech/atlas-wire/web'

import { detailOf } from '../data/subscription-model'
import { ESubscriptionsStatus, type SubscriptionsData } from '../data/use-subscriptions'
import { useNow } from '../data/use-now'
import { useThreadPanel } from './thread-panel-context'
import { TabPlaceholder } from './tab-placeholder'

const EMPTY_DESCRIPTION =
  'The agent subscribes with the subscribe tool, or use the bell on a pull request.'

function SubscriptionRow(props: {
  subscription: SubscriptionWire
  now: number
  busy: boolean
  onPausedChange: (paused: boolean) => void
  onRemove: () => void
}) {
  const { subscription, now, busy, onPausedChange, onRemove } = props
  const active = subscription.status === ESubscriptionStatusWire.Active
  return (
    <Item variant="outline" size="sm" data-status={subscription.status}>
      <ItemContent>
        <ItemTitle className="font-mono">{subscription.label}</ItemTitle>
        <ItemDescription>
          {active ? null : <span className="font-medium">Paused · </span>}
          {detailOf({ subscription, now })}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch
          size="sm"
          checked={active}
          disabled={busy}
          aria-label={`${active ? 'Pause' : 'Resume'} ${subscription.label}`}
          onCheckedChange={(checked) => onPausedChange(!checked)}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={busy}
                aria-label={`Remove ${subscription.label}`}
                className="text-muted-foreground"
                onClick={onRemove}
              />
            }
          >
            <Trash2Icon />
          </TooltipTrigger>
          <TooltipContent side="top">Remove</TooltipContent>
        </Tooltip>
      </ItemActions>
    </Item>
  )
}

export function SubscriptionsTab(props: { data: SubscriptionsData }) {
  const { status, subscriptions, busy, setPaused, remove } = props.data
  const { channel } = useThreadPanel()
  const now = useNow(subscriptions.some((subscription) => subscription.expiresAt !== undefined))

  if (channel === null) {
    return (
      <TabPlaceholder
        icon={<WifiOffIcon />}
        title="Connecting to the pod"
        description="Subscriptions appear as soon as it answers."
      />
    )
  }
  if (status === ESubscriptionsStatus.Loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Spinner />
      </div>
    )
  }
  if (status === ESubscriptionsStatus.Unsupported) {
    return (
      <TabPlaceholder
        icon={<BellIcon />}
        title="Subscriptions unavailable"
        description={SUBSCRIPTIONS_TOO_OLD}
      />
    )
  }
  if (subscriptions.length === 0) {
    return (
      <TabPlaceholder
        icon={<BellIcon />}
        title="No subscriptions"
        description={EMPTY_DESCRIPTION}
      />
    )
  }

  return (
    <div className="p-3">
      <ItemGroup>
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
      </ItemGroup>
    </div>
  )
}
