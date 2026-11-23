'use client'

import type { SpendTally } from '@dltech/atlas-core'
import { Context } from '@dltech/atlas-ui/ai/context'
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
  const stats = spend === null ? null : tokenStatsOf(spend)
  const cost = spend?.costUsd ?? null
  return (
    <Context
      className="ml-auto"
      used={context.used}
      limit={context.limit}
      breakdown={[...context.breakdown]}
    >
      {cost === null && stats === null ? null : (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4 text-muted-foreground">
          {cost === null ? null : <Stat value={formatUsd(cost)} unit="spent" />}
          {stats === null ? null : <Tokens stats={stats} />}
          {stats?.cached == null ? null : <Stat value={stats.cached} unit="cached" />}
        </p>
      )}
    </Context>
  )
}
