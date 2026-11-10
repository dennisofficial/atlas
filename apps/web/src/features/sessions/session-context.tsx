'use client'

import type { SpendTally } from '@dltech/atlas-core'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@dltech/atlas-ui/components/hover-card'
import { Progress } from '@dltech/atlas-ui/components/progress'
import { contextPercent, formatTokens } from '@dltech/atlas-ui/ai/context'
import { formatUsd } from '@dltech/atlas-core'

import { Stat, Tokens } from '@/features/threads/panel/details/head-section'
import { tokenStatsOf } from '@/features/threads/panel/details/details-model'

import type { SessionContextModel } from './data/session-view-model'

export function SessionContext({
  context,
  spend,
}: {
  context: SessionContextModel | null
  spend: SpendTally | null
}) {
  if (context === null) return null
  const percent = contextPercent(context)
  const stats = spend === null ? null : tokenStatsOf(spend)
  const cost = spend?.costUsd ?? null
  const reading = percent === null ? '—' : `${percent}%`
  const label = percent === null ? 'Context not measured yet' : `Context ${percent}%`
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={10}
        closeDelay={100}
        render={
          <Button variant="ghost" size="sm" className="ml-auto tabular-nums" aria-label={label} />
        }
      >
        {reading}
        {percent === null ? '' : ' context'}
      </HoverCardTrigger>
      <HoverCardContent>
        <div className="flex w-64 flex-col gap-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">Context</span>
            <span className="text-muted-foreground tabular-nums">
              {context.used === null ? 'not measured yet' : formatTokens(context.used)} /{' '}
              {formatTokens(context.limit)}
            </span>
          </div>
          {percent === null ? null : <Progress value={percent} aria-label="Context used" />}
          {cost === null && stats === null ? null : (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4 text-muted-foreground">
              {cost === null ? null : <Stat value={formatUsd(cost)} unit="spent" />}
              {stats === null ? null : <Tokens stats={stats} />}
              {stats?.cached == null ? null : <Stat value={stats.cached} unit="cached" />}
            </p>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
