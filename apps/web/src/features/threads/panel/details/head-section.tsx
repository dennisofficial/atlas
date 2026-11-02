'use client'

import { formatUsd } from '@dltech/atlas-core'
import type { PodStatus } from '@dltech/atlas-wire/web'
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { chipStatusOf, podStateLabelOf } from '../../data/pod-chip-model'
import { useThreadSpend } from '../../data/use-thread-spend'
import { ThreadPodChip } from '../../thread-pod-chip'
import { useThreadPanel } from '../thread-panel-context'
import { tokenStatsOf, turnCountOf, type TokenStats } from './details-model'

function Stat(props: { value: ReactNode; unit: string }) {
  return (
    <span className="flex h-4 items-center gap-1 whitespace-nowrap">
      <span className="text-foreground tabular-nums">{props.value}</span>
      <span>{props.unit}</span>
    </span>
  )
}

function Tokens({ stats }: { stats: TokenStats }) {
  return (
    <span className="flex h-4 items-center gap-1.5 whitespace-nowrap tabular-nums">
      <span className="flex items-center gap-0.5">
        <ArrowUpIcon role="img" aria-label="Input tokens" className="size-3" />
        <span className="text-foreground">{stats.input}</span>
      </span>
      <span className="flex items-center gap-0.5">
        <ArrowDownIcon role="img" aria-label="Output tokens" className="size-3" />
        <span className="text-foreground">{stats.output}</span>
      </span>
    </span>
  )
}

function ServeVersion({ pod }: { pod: PodStatus | null }) {
  const version = pod?.resources?.serveVersion
  if (version === undefined) return null
  return (
    <span className="flex h-4 items-center whitespace-nowrap font-mono">atlas-serve {version}</span>
  )
}

export function HeadSection() {
  const { threadId, channel, working, details, pod } = useThreadPanel()
  const spend = useThreadSpend({ threadId, channel, working })
  const turns = turnCountOf(details.events)
  const stats = spend === null ? null : tokenStatsOf(spend)
  const cost = spend?.costUsd ?? null
  const chipShown = chipStatusOf(pod) !== null

  return (
    <header className="flex flex-col gap-2 px-1">
      <div className="flex items-start justify-between gap-3">
        {details.title === null ? (
          <span />
        ) : (
          <h2 className="line-clamp-2 min-w-0 pt-0.5 text-sm font-medium">{details.title}</h2>
        )}
        {chipShown ? (
          <ThreadPodChip
            pod={pod}
            working={working}
            onResize={details.onResize}
            settingsHref={details.settingsHref}
          />
        ) : (
          <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">
            {podStateLabelOf(pod) ?? 'No pod yet'}
          </span>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4 text-muted-foreground">
        <Stat value={turns} unit={turns === 1 ? 'turn' : 'turns'} />
        {cost === null ? null : <Stat value={formatUsd(cost)} unit="spent" />}
        {stats === null ? null : <Tokens stats={stats} />}
        {stats?.cached == null ? null : <Stat value={stats.cached} unit="cached" />}
        <ServeVersion pod={pod} />
      </p>
    </header>
  )
}
