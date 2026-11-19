'use client'

import { formatElapsed } from '@dltech/atlas-client/transcript'

import { EHeaderState, STATE_LABEL } from '@/features/threads/data/header-model'
import { useNowEvery } from '@/features/threads/data/use-now'

import { headerStateOfSession } from '../../data/session-state'
import { useSessionPaneValue } from '../pane-value'
import { Pill } from './rows'

const PILL_TONE: Record<EHeaderState, string> = {
  [EHeaderState.Failed]: 'bg-destructive/10 text-destructive',
  [EHeaderState.NeedsYou]: 'bg-primary/10 text-primary',
  [EHeaderState.Queued]: 'bg-muted text-muted-foreground',
  [EHeaderState.Running]: 'bg-success/10 text-success',
  [EHeaderState.Idle]: 'bg-muted text-muted-foreground',
}

const ELAPSED_TICK_MS = 30_000

function elapsedOf(args: { startedAt: string | undefined; now: number }): string | null {
  if (args.startedAt === undefined) return null
  const started = Date.parse(args.startedAt)
  if (Number.isNaN(started)) return null
  return formatElapsed(Math.max(0, args.now - started))
}

export function SessionDetailsHeader() {
  const { title, startedAt, status } = useSessionPaneValue()
  const now = useNowEvery({ enabled: startedAt !== undefined, tickMs: ELAPSED_TICK_MS })
  const state = headerStateOfSession(status)
  const elapsed = elapsedOf({ startedAt, now })

  return (
    <header data-session-summary className="flex flex-col gap-1">
      <h2 className="truncate text-[13px] leading-5 font-medium">{title ?? 'Session'}</h2>
      <div className="flex items-center gap-2">
        <span data-session-state className="inline-flex items-center gap-1">
          <Pill label={STATE_LABEL[state]} tone={PILL_TONE[state]} />
        </span>
        {elapsed === null ? null : (
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {elapsed}
          </span>
        )}
      </div>
    </header>
  )
}
