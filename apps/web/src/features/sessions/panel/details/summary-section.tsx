'use client'

import { formatUsd } from '@dltech/atlas-core'
import { formatTokens } from '@dltech/atlas-ui/ai/context'
import { Badge } from '@dltech/atlas-ui/components/badge'

import { STATE_LABEL } from '@/features/threads/data/header-model'
import { tokenStatsOf } from '@/features/threads/panel/details/details-model'

import { headerStateOfSession } from '../../data/session-state'
import type { SessionContextModel } from '../../data/session-view-model'
import { useSessionPaneValue } from '../pane-value'

const contextLabelOf = (context: SessionContextModel | null): string => {
  if (context === null || context.used === null) return 'Context not measured yet'
  return `${formatTokens(context.used)} / ${formatTokens(context.limit)}`
}

export function SessionSummarySection() {
  const { view, status } = useSessionPaneValue()
  const stats = view.spend === null ? null : tokenStatsOf(view.spend)
  const cost = view.spend?.costUsd ?? null
  return (
    <header data-session-summary className="flex flex-col gap-2 px-1">
      <div className="flex flex-wrap items-center gap-2">
        <span data-session-state className="text-xs text-muted-foreground">
          {STATE_LABEL[headerStateOfSession(status)]}
        </span>
        {view.branch === undefined ? null : (
          <Badge variant="outline" data-session-pane-branch className="max-w-48">
            <span className="truncate font-mono">{view.branch}</span>
          </Badge>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4 text-muted-foreground">
        <span data-session-context>{contextLabelOf(view.context)}</span>
        {cost === null ? null : (
          <span data-session-spend className="whitespace-nowrap tabular-nums">
            {formatUsd(cost)} spent
          </span>
        )}
        {stats === null ? null : (
          <span data-session-tokens className="whitespace-nowrap tabular-nums">
            {stats.input} in · {stats.output} out
          </span>
        )}
        {stats?.cached == null ? null : (
          <span data-session-cached className="whitespace-nowrap tabular-nums">
            {stats.cached} cached
          </span>
        )}
      </p>
    </header>
  )
}
