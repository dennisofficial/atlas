'use client'

import { ESubscriptionStatus } from '@dltech/atlas-core'
import type { SubscriptionListRow } from '@dltech/atlas-plugin-github/client'
import { Button } from '@dltech/atlas-ui/components/button'
import { Switch } from '@dltech/atlas-ui/components/switch'
import { cn } from '@dltech/atlas-ui/lib/utils'
import { Bell, Trash2Icon } from 'lucide-react'
import { DynamicIcon } from 'lucide-react/dynamic'
import { useState } from 'react'

import { useNowEvery } from '@/features/threads/data/use-now'

import { sessionsApi } from '../../data/sessions-api'
import { useSessionPaneValue } from '../pane-value'
import { Row, SectionHead } from './rows'
import {
  iconNameOf,
  removeCommandOf,
  statusCommandOf,
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
  busy: boolean
  onCommand: (command: SubscriptionCommand) => void
}) {
  const { row, now } = props
  const active = row.status === ESubscriptionStatus.Active
  const meta = subscriptionMetaOf({ row, now })
  const title = subscriptionTitleOf(row.presentation.title)

  return (
    <div data-subscription-row={row.id} className={cn(!active && 'opacity-50')}>
      <Row
        leading={<SubscriptionIcon row={row} />}
        title={
          <span title={row.presentation.title}>
            {title.number === undefined ? null : <span className="font-mono">{title.number}</span>}
            {title.number === undefined || title.text.length === 0 ? null : ' '}
            {title.text}
          </span>
        }
        meta={
          <span>
            {meta.paused ? <span className="font-medium">Paused · </span> : null}
            {meta.text}
          </span>
        }
        trailing={
          <>
            <Switch
              size="sm"
              checked={active}
              disabled={props.busy}
              aria-label={`${active ? 'Pause' : 'Resume'} ${row.presentation.title}`}
              onCheckedChange={(checked) => props.onCommand(statusCommandOf(row, checked))}
            />
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={props.busy}
              aria-label={`Remove ${row.presentation.title}`}
              className="text-muted-foreground"
              onClick={() => props.onCommand(removeCommandOf(row))}
            >
              <Trash2Icon />
            </Button>
          </>
        }
      />
    </div>
  )
}

export function SessionSubscriptionsSection({ run = runThroughApi }: { run?: SubscriptionRun }) {
  const { sessionId, view } = useSessionPaneValue()
  const rows = view.subscriptionRows
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const now = useNowEvery({
    enabled: rows.some((row) => row.expiresAt !== undefined),
    tickMs: TICK_MS,
  })
  if (rows.length === 0) return null
  const visible = expanded ? rows : rows.slice(0, VISIBLE_ROWS)
  const handleToggle = () => setExpanded((held) => !held)
  const handleCommand = (command: SubscriptionCommand) => {
    const { subscriptionId } = command.args
    setBusy((current) => new Set(current).add(subscriptionId))
    void run({ sessionId, command }).finally(() =>
      setBusy((current) => {
        const next = new Set(current)
        next.delete(subscriptionId)
        return next
      }),
    )
  }

  return (
    <section data-session-subscriptions aria-label="Subscriptions" className="flex flex-col">
      <SectionHead title="Subscriptions" count={rows.length} />
      {visible.map((row) => (
        <SubscriptionRowItem
          key={row.id}
          row={row}
          now={now}
          busy={busy.has(row.id)}
          onCommand={handleCommand}
        />
      ))}
      {rows.length > VISIBLE_ROWS ? (
        <button
          type="button"
          onClick={handleToggle}
          className="mt-0.5 ml-[1.625rem] w-fit rounded-sm text-[11px] leading-4 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {expanded ? 'Show fewer' : `Show all (${rows.length})`}
        </button>
      ) : null}
    </section>
  )
}
