'use client'

import { Bell, GitBranch, Globe, Terminal } from 'lucide-react'

import type { CrewRoster, CrewRow } from '@dltech/atlas-plugin-crew/client'
import type { SubscribedPullRequest } from '@dltech/atlas-plugin-github/client'
import type { PreviewItem } from '@dltech/atlas-plugin-services/client'
import type { ShellRoster } from '@dltech/atlas-plugin-shells/client'

import { NamingTitle } from '@dltech/atlas-ui/ai/naming-title'
import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dltech/atlas-ui/components/popover'
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

import { HeaderCrew } from './crew-panel'
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

const SHELL_TAIL_LINES = 20

const SHELL_TAIL_CHARACTERS = 4_000

export function shellTailOf(text: string | undefined): string {
  if (text === undefined) return ''
  const tail = text.split('\n').slice(-SHELL_TAIL_LINES).join('\n')
  return tail.slice(-SHELL_TAIL_CHARACTERS)
}

export function ShellTails({
  shells,
  tails,
}: {
  shells: ShellRoster
  tails: Readonly<Record<string, string>>
}) {
  return (
    <ul data-shell-tails className="flex flex-col gap-2.5">
      {shells.rows.map((row) => {
        const tail = shellTailOf(tails[row.shellId])
        return (
          <li key={row.shellId} className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-mono text-xs text-muted-foreground" title={row.name}>
              {row.name}
            </span>
            {tail === '' ? (
              <span className="text-xs text-muted-foreground italic">No output yet</span>
            ) : (
              <pre
                data-shell-tail={row.shellId}
                className="max-h-40 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words"
              >
                {tail}
              </pre>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function HeaderShells({
  shells,
  tails,
}: {
  shells: ShellRoster
  tails: Readonly<Record<string, string>>
}) {
  return (
    <Popover>
      <PopoverTrigger
        data-session-shells
        aria-label={`Running shells: ${shells.running}`}
        title={shells.labels.join(', ')}
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground tabular-nums"
          />
        }
      >
        <Terminal className="size-3" aria-hidden />
        <span className="font-mono">{shells.running}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[32rem] max-w-[calc(100vw-2rem)]">
        <ShellTails shells={shells} tails={tails} />
      </PopoverContent>
    </Popover>
  )
}

export function PreviewLinks({ previews }: { previews: readonly PreviewItem[] }) {
  return (
    <ul data-preview-links className="flex flex-col gap-1.5">
      {previews.map((preview) => (
        <li key={preview.serviceId} className="flex min-w-0 items-baseline gap-2">
          <a
            href={preview.url}
            target="_blank"
            rel="noreferrer"
            title={preview.url}
            className="min-w-0 flex-1 truncate underline-offset-2 hover:underline"
          >
            {preview.label}
          </a>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">:{preview.port}</span>
        </li>
      ))}
    </ul>
  )
}

function HeaderPreviews({ previews }: { previews: readonly PreviewItem[] }) {
  return (
    <Popover>
      <PopoverTrigger
        data-session-previews
        aria-label="Previews"
        title={previews.map((preview) => `${preview.label}:${preview.port}`).join(', ')}
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground tabular-nums"
          />
        }
      >
        <Globe className="size-3" aria-hidden />
        <span className="font-mono">{previews.length}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PreviewLinks previews={previews} />
      </PopoverContent>
    </Popover>
  )
}

export function SessionHeader({
  sessionId,
  state,
  routineId = null,
  title,
  naming,
  branch,
  entries,
  subscriptions,
  shells,
  shellTails,
  crew,
  crewRows,
  previews,
}: {
  sessionId: string
  state: EHeaderState
  routineId?: string | null
  title: string | null
  naming: boolean
  branch: string | undefined
  entries: readonly PullRequestEntry[]
  subscriptions: readonly SubscribedPullRequest[]
  shells: ShellRoster
  shellTails: Readonly<Record<string, string>>
  crew: CrewRoster
  crewRows: readonly CrewRow[]
  previews: readonly PreviewItem[]
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
        {routineId === null ? null : (
          <Badge variant="outline" data-session-routine>
            routine
          </Badge>
        )}
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
        {shells.running === 0 ? null : <HeaderShells shells={shells} tails={shellTails} />}
        {crew.total === 0 ? null : <HeaderCrew roster={crew} rows={crewRows} />}
        {previews.length === 0 ? null : <HeaderPreviews previews={previews} />}
        <Badge variant={BADGE_VARIANT[state]}>{STATE_LABEL[state]}</Badge>
      </div>
    </header>
  )
}
