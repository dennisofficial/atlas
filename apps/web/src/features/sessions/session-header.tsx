'use client'

import { GitBranch } from 'lucide-react'

import { NamingTitle } from '@dltech/atlas-ui/ai/naming-title'
import { Badge } from '@dltech/atlas-ui/components/badge'
import { SidebarTrigger } from '@dltech/atlas-ui/components/sidebar'

import {
  PullRequestChecks,
  PullRequestConflict,
  PullRequestIcon,
} from '@/features/shell/thread-pr-presentation'
import { EHeaderState, STATE_LABEL } from '@/features/threads/data/header-model'
import {
  pinnedPullRequestOf,
  type PullRequestEntry,
} from '@/features/threads/data/pull-request-entries'

import { useSessionPrObservation } from './data/use-session-pr-observation'

const BADGE_VARIANT: Record<EHeaderState, 'destructive' | 'default' | 'secondary'> = {
  [EHeaderState.Failed]: 'destructive',
  [EHeaderState.NeedsYou]: 'default',
  [EHeaderState.Running]: 'secondary',
  [EHeaderState.Idle]: 'secondary',
}

function HeaderPullRequest({ pinned, count }: { pinned: PullRequestEntry; count: number }) {
  return (
    <span data-session-pr className="flex shrink-0 items-center gap-1.5 text-xs">
      <PullRequestIcon entry={pinned} />
      <a
        href={pinned.url}
        target="_blank"
        rel="noreferrer"
        className="font-mono underline-offset-2 hover:underline"
      >
        #{pinned.number}
      </a>
      <PullRequestConflict entry={pinned} />
      <PullRequestChecks entry={pinned} />
      {count > 1 ? (
        <span role="img" className="font-mono" aria-label={`${count - 1} more pull requests`}>
          +{count - 1}
        </span>
      ) : null}
    </span>
  )
}

export function SessionHeader({
  state,
  title,
  naming,
  branch,
  entries,
}: {
  state: EHeaderState
  title: string | null
  naming: boolean
  branch: string | undefined
  entries: readonly PullRequestEntry[]
}) {
  const observationRef = useSessionPrObservation(entries)
  const pinned = pinnedPullRequestOf(entries)
  return (
    <header
      ref={observationRef}
      data-chrome="titlebar"
      className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-2 md:px-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger aria-label="Open navigation" />
        <h1 className="min-w-0 truncate text-sm font-medium">
          <NamingTitle title={title} naming={naming} fallback="Session" />
        </h1>
        <Badge variant="outline">v2</Badge>
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-3">
        {branch === undefined ? null : (
          <Badge variant="outline" data-session-branch className="hidden max-w-48 sm:inline-flex">
            <GitBranch aria-hidden />
            <span className="truncate font-mono">{branch}</span>
          </Badge>
        )}
        {pinned === undefined ? null : <HeaderPullRequest pinned={pinned} count={entries.length} />}
        <Badge variant={BADGE_VARIANT[state]}>{STATE_LABEL[state]}</Badge>
      </div>
    </header>
  )
}
