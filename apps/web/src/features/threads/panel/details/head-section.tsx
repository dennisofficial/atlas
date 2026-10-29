'use client'

import { formatUsd } from '@dltech/atlas-core'

import { useThreadSpend } from '../../data/use-thread-spend'
import { tokenFiguresOf, turnCountOf, turnsLabelOf } from './details-model'
import { useThreadPanel } from '../thread-panel-context'

export function HeadSection() {
  const { threadId, channel, working, details } = useThreadPanel()
  const spend = useThreadSpend({ threadId, channel, working })
  const turns = turnCountOf(details.events)
  if (details.title === null && spend === null) return null

  const figures = spend === null ? null : tokenFiguresOf(spend)
  const cost = spend?.costUsd ?? null
  return (
    <div className="flex flex-col gap-0.5 px-1">
      {details.title === null ? null : (
        <p className="line-clamp-2 text-sm font-medium">{details.title}</p>
      )}
      <p className="text-xs text-muted-foreground tabular-nums">
        {turnsLabelOf(turns)}
        {cost === null ? null : ` · ${formatUsd(cost)}`}
      </p>
      {figures === null ? null : (
        <p className="font-mono text-xs text-muted-foreground tabular-nums">{figures}</p>
      )}
    </div>
  )
}
