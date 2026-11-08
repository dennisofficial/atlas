'use client'

import { Bell, GitBranch } from 'lucide-react'

import type { SubscribedPullRequest } from '@dltech/atlas-plugin-github/client'

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

import { RenameAction } from '@/features/shell/rename-action'

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

function HeaderSubscriptions({
  subscriptions,
}: {
  subscriptions: readonly SubscribedPullRequest[]
}) {
  return (
    <span
      data-session-subscriptions
      className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Bell className="size-3" aria-label="Subscribed to" role="img" />
      {subscriptions.map((subscription) => (
        <a
          key={subscription.url}
          href={subscription.url}
          target="_blank"
          rel="noreferrer"
          title={subscription.label}
          className="font-mono underline-offset-2 hover:underline"
        >
          #{subscription.number}
        </a>
      ))}
    </span>
  )
}

export function SessionHeader({
  sessionId,
  state,
  title,
  naming,
  branch,
  entries,
  subscriptions,
}: {
  sessionId: string
  state: EHeaderState
  title: string | null
  naming: boolean
  branch: string | undefined
  entries: readonly PullRequestEntry[]
  subscriptions: readonly SubscribedPullRequest[]
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
        <RenameAction sessionId={sessionId} title={title} />
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
        {subscriptions.length === 0 ? null : <HeaderSubscriptions subscriptions={subscriptions} />}
        <Badge variant={BADGE_VARIANT[state]}>{STATE_LABEL[state]}</Badge>
      </div>
    </header>
  )
}
