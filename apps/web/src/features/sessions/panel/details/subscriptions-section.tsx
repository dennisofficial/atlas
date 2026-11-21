'use client'

import type { SubscriptionListRow } from '@dltech/atlas-plugin-github/client'
import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'
import { Bell, Trash2Icon } from 'lucide-react'
import { DynamicIcon } from 'lucide-react/dynamic'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { useNowEvery } from '@/features/threads/data/use-now'
import { messageOf } from '@/features/threads/data/use-send'

import { sessionsApi } from '../../data/sessions-api'
import { useSessionPaneValue } from '../pane-value'
import { Row, SectionHead } from './rows'
import {
  iconNameOf,
  removeCommandOf,
  SUBSCRIPTION_TONE_CLASS,
  subscriptionMetaOf,
  subscriptionTitleOf,
  type SubscriptionCommand,
} from './subscription-row-model'

const VISIBLE_ROWS = 5
const TICK_MS = 30_000

export type SubscriptionRun = (args: {
  sessionId: string
  command: SubscriptionCommand
}) => Promise<void>

const runThroughApi: SubscriptionRun = async ({ sessionId, command }) => {
  await sessionsApi.command({ sessionId, name: command.name, args: command.args })
}

function SubscriptionIcon({ row }: { row: SubscriptionListRow }) {
  const name = iconNameOf(row.presentation.icon)
  const className = cn('size-3.5', SUBSCRIPTION_TONE_CLASS[row.presentation.tone])
  const fallback = () => <Bell className={className} aria-hidden />
  if (name === undefined) return fallback()
  return <DynamicIcon name={name} className={className} fallback={fallback} />
}

function SubscriptionRowItem(props: {
  row: SubscriptionListRow
  now: number
  onRemove: () => void
}) {
  const { row, now } = props
  const meta = subscriptionMetaOf({ row, now })
  const title = subscriptionTitleOf(row.presentation.title)

  return (
    <div data-subscription-row={row.id}>
      <Row
        leading={<SubscriptionIcon row={row} />}
        title={
          <span title={row.presentation.title}>
            {title.number === undefined ? null : <span className="font-mono">{title.number}</span>}
            {title.number === undefined || title.text.length === 0 ? null : ' '}
            {title.text}
          </span>
        }
        meta={<span>{meta}</span>}
        trailing={
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

export function SessionSubscriptionsSection({ run = runThroughApi }: { run?: SubscriptionRun }) {
  const { sessionId, view } = useSessionPaneValue()
  const rows = view.subscriptionRows
  const [expanded, setExpanded] = useState(false)
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set())
  const now = useNowEvery({
    enabled: rows.some((row) => row.expiresAt !== undefined),
    tickMs: TICK_MS,
  })

  useEffect(() => {
    const live = new Set(rows.map((row) => row.id))
    const stale = [...removing].filter((id) => !live.has(id))
    if (stale.length === 0) return
    setRemoving((current) => new Set([...current].filter((id) => live.has(id))))
  }, [removing, rows])

  const shown = rows.filter((row) => !removing.has(row.id))
  if (shown.length === 0) return null
  const visible = expanded ? shown : shown.slice(0, VISIBLE_ROWS)
  const handleToggle = () => setExpanded((held) => !held)
  const restore = (subscriptionId: string) =>
    setRemoving((current) => {
      const next = new Set(current)
      next.delete(subscriptionId)
      return next
    })
  const handleRemove = (row: SubscriptionListRow) => {
    setRemoving((current) => new Set(current).add(row.id))
    run({ sessionId, command: removeCommandOf(row) }).catch((failure: unknown) => {
      restore(row.id)
      toast.error(messageOf(failure))
    })
  }

  return (
    <section data-session-subscriptions aria-label="Subscriptions" className="flex flex-col">
      <SectionHead title="Subscriptions" count={shown.length} />
      {visible.map((row) => (
        <SubscriptionRowItem key={row.id} row={row} now={now} onRemove={() => handleRemove(row)} />
      ))}
      {shown.length > VISIBLE_ROWS ? (
        <button
          type="button"
          onClick={handleToggle}
          className="mt-0.5 ml-[1.625rem] w-fit rounded-sm text-[11px] leading-4 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {expanded ? 'Show fewer' : `Show all (${shown.length})`}
        </button>
      ) : null}
    </section>
  )
}
