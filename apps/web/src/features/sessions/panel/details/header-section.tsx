'use client'

import { formatTokens } from '@dltech/atlas-client/crew'
import { formatElapsed } from '@dltech/atlas-client/transcript'
import { formatUsd, sandboxComputeAt, type SandboxCompute } from '@dltech/atlas-core'
import type { ReactNode } from 'react'

import { useNowEvery } from '@/features/threads/data/use-now'
import { tokenStatsOf } from '@/features/threads/panel/details/details-model'

import { useSessionPaneValue } from '../pane-value'
import { cacheHitRateOf } from './usage-model'

const ELAPSED_TICK_MS = 30_000

function elapsedOf(args: { startedAt: string | undefined; now: number }): string | null {
  if (args.startedAt === undefined) return null
  const started = Date.parse(args.startedAt)
  if (Number.isNaN(started)) return null
  return formatElapsed(Math.max(0, args.now - started))
}

const SANDBOX_TICK_MS = 5_000

function SandboxCost({ compute }: { compute: SandboxCompute }) {
  const running = compute.tick !== null
  const now = useNowEvery({ enabled: running, tickMs: SANDBOX_TICK_MS })
  const aged = sandboxComputeAt({ compute, now })
  if (aged.costUsd === null) return null
  return <UsageStat value={formatUsd(aged.costUsd)} unit="sandbox" />
}

function UsageStat(props: { value: ReactNode; unit: string; title?: string }) {
  return (
    <span title={props.title} className="whitespace-nowrap">
      <span className="text-foreground">{props.value}</span>
      <span className="text-muted-foreground"> {props.unit}</span>
    </span>
  )
}

function UsageLine({ start, end }: { start: ReactNode; end: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="flex min-w-0 flex-wrap gap-x-2.5">{start}</span>
      <span className="shrink-0">{end}</span>
    </div>
  )
}

export function SessionDetailsHeader() {
  const { startedAt, view } = useSessionPaneValue()
  const now = useNowEvery({ enabled: startedAt !== undefined, tickMs: ELAPSED_TICK_MS })
  const elapsed = elapsedOf({ startedAt, now })
  const spend = view.spend
  const cost = spend?.costUsd ?? null
  const stats = spend === null ? null : tokenStatsOf(spend)
  const cacheHitRate = cacheHitRateOf(spend)
  const compute = view.compute
  const hasSandboxCost = compute !== undefined && compute.costUsd !== null
  const hasSpend = cost !== null || stats !== null || cacheHitRate !== null || hasSandboxCost
  if (elapsed === null && !hasSpend) return null
  const hasCostLine = cost !== null || hasSandboxCost || elapsed !== null
  const hasTokenLine = stats !== null || cacheHitRate !== null

  return (
    <header data-session-summary className="flex flex-col gap-1 text-xs leading-5 tabular-nums">
      <div data-session-spend={hasSpend || undefined} className="contents">
        {hasCostLine ? (
          <UsageLine
            start={
              <>
                {cost === null ? null : <UsageStat value={formatUsd(cost)} unit="spent" />}
                {hasSandboxCost ? <SandboxCost compute={compute} /> : null}
              </>
            }
            end={elapsed === null ? null : <UsageStat value={elapsed} unit="running" />}
          />
        ) : null}
        {hasTokenLine ? (
          <UsageLine
            start={
              stats === null ? null : (
                <>
                  <UsageStat value={stats.input} unit="in" title="Input tokens" />
                  <UsageStat value={stats.output} unit="out" title="Output tokens" />
                </>
              )
            }
            end={
              cacheHitRate === null || spend === null ? null : (
                <UsageStat
                  value={`${cacheHitRate}%`}
                  unit="cached"
                  title={`${formatTokens(spend.cacheReadTokens)} tokens read from cache`}
                />
              )
            }
          />
        ) : null}
      </div>
    </header>
  )
}
