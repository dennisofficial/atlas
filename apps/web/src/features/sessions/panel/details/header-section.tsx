'use client'

import { formatElapsed } from '@dltech/atlas-client/transcript'
import {
  formatUsd,
  sandboxComputeAt,
  type SandboxCompute,
  type SpendTally,
} from '@dltech/atlas-core'
import type { SessionViewOutput } from '@dltech/atlas-protocol'

import { EHeaderState, STATE_LABEL } from '@/features/threads/data/header-model'
import { useNowEvery } from '@/features/threads/data/use-now'
import { tokenStatsOf } from '@/features/threads/panel/details/details-model'
import { Stat, Tokens } from '@/features/threads/panel/details/head-section'

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

type SessionCompute = SessionViewOutput['compute']

const SANDBOX_TICK_MS = 5_000

function SandboxCost({ compute }: { compute: SandboxCompute | undefined }) {
  const running = compute?.tick != null
  const now = useNowEvery({ enabled: running, tickMs: SANDBOX_TICK_MS })
  if (compute === undefined || compute.costUsd === null) return null
  const aged = sandboxComputeAt({ compute, now })
  if (aged.costUsd === null) return null
  return <Stat value={formatUsd(aged.costUsd)} unit="sandbox" />
}

function SpendLine({
  spend,
  compute,
}: {
  spend: SpendTally | null
  compute: SessionCompute | undefined
}) {
  const stats = spend === null ? null : tokenStatsOf(spend)
  if (spend === null || stats === null) return null
  return (
    <p
      data-session-spend
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4 text-muted-foreground"
    >
      {spend.costUsd === null ? null : <Stat value={formatUsd(spend.costUsd)} unit="spent" />}
      <Tokens stats={stats} />
      {stats.cached == null ? null : <Stat value={stats.cached} unit="cached" />}
      <SandboxCost compute={compute} />
    </p>
  )
}

export function SessionDetailsHeader() {
  const { title, startedAt, status, view } = useSessionPaneValue()
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
      <SpendLine spend={view.spend} compute={view.compute} />
    </header>
  )
}
