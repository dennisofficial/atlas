'use client'

import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'
import { Bell, Trash2Icon } from 'lucide-react'
import { DynamicIcon } from 'lucide-react/dynamic'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { messageOf } from '@/features/threads/data/message-of'

import { sessionsApi } from '../../data/sessions-api'
import type { SubscriptionRow } from '../../data/subscription-rows'
import { useSessionPaneValue } from '../pane-value'
import { Row, RowsToggle, SectionHead } from './rows'
import { Reveal, RevealRows } from './reveal'
import {
  iconNameOf,
  SUBSCRIPTION_TONE_CLASS,
  subscriptionMetaOf,
  subscriptionTitleOf,
} from './subscription-row-model'

const VISIBLE_ROWS = 5

export type UnsubscribeRun = (args: {
  sessionId: string
  subscriptionId: string
}) => Promise<unknown>

const runThroughApi: UnsubscribeRun = async ({ sessionId, subscriptionId }) => {
  await sessionsApi.unsubscribe({ sessionId, subscriptionId })
}

function SubscriptionIcon({ row }: { row: SubscriptionRow }) {
  const name = iconNameOf(row.presentation.icon)
  const className = cn('size-3.5', SUBSCRIPTION_TONE_CLASS[row.presentation.tone])
  const fallback = () => <Bell className={className} aria-hidden />
  if (name === undefined) return fallback()
  return <DynamicIcon name={name} className={className} fallback={fallback} />
}

function SubscriptionRowItem(props: { row: SubscriptionRow; onRemove: () => void }) {
  const { row } = props
  const meta = subscriptionMetaOf(row)
  const title = subscriptionTitleOf(row.presentation.title)

  return (
    <div data-subscription-row={row.id}>
      <Row
        leading={<SubscriptionIcon row={row} />}
        title={
          <span title={row.presentation.title}>
            {title.number === undefined ? null : (
              <span className="tabular-nums">{title.number}</span>
            )}
            {title.number === undefined || title.text.length === 0 ? null : ' '}
            {title.text}
          </span>
        }
        meta={<span>{meta}</span>}
        actions={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${row.presentation.title}`}
            className="text-muted-foreground"
            onClick={props.onRemove}
          >
            <Trash2Icon />
          </Button>
        }
      />
    </div>
  )
}

export function SessionSubscriptionsSection({ run = runThroughApi }: { run?: UnsubscribeRun }) {
  const { sessionId, view } = useSessionPaneValue()
  const rows = view.subscriptionRows
  const [expanded, setExpanded] = useState(false)
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    const live = new Set(rows.map((row) => row.id))
    const stale = [...removing].filter((id) => !live.has(id))
    if (stale.length === 0) return
    setRemoving((current) => new Set([...current].filter((id) => live.has(id))))
  }, [removing, rows])

  const shown = rows.filter((row) => !removing.has(row.id))
  const visible = expanded ? shown : shown.slice(0, VISIBLE_ROWS)
  const handleToggle = () => setExpanded((held) => !held)
  const restore = (subscriptionId: string) =>
    setRemoving((current) => {
      const next = new Set(current)
      next.delete(subscriptionId)
      return next
    })
  const handleRemove = (row: SubscriptionRow) => {
    setRemoving((current) => new Set(current).add(row.id))
    run({ sessionId, subscriptionId: row.id }).catch((failure: unknown) => {
      restore(row.id)
      toast.error(messageOf(failure))
    })
  }

  return (
    <Reveal open={shown.length > 0} section>
      <section data-session-subscriptions aria-label="Subscriptions" className="flex flex-col">
        <SectionHead title="Subscriptions" count={shown.length} />
        <RevealRows
          rows={visible}
          rowKey={(row) => row.id}
          render={(row) => (
            <SubscriptionRowItem key={row.id} row={row} onRemove={() => handleRemove(row)} />
          )}
        />
        {shown.length > VISIBLE_ROWS ? (
          <RowsToggle expanded={expanded} onToggle={handleToggle}>
            {expanded ? 'Show fewer' : `Show all (${shown.length})`}
          </RowsToggle>
        ) : null}
      </section>
    </Reveal>
  )
}
