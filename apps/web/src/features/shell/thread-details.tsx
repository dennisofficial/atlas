import { Folder } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { displayedThreadTitle } from '@dltech/atlas-core'
import { Separator } from '@dltech/atlas-ui/components/separator'
import type { PrStateWire, WireThread } from '@dltech/atlas-wire/web'
import { relativeTime } from '@/features/settings/data/personal/relative-time'
import {
  pullRequestKeyOf,
  type PullRequestEntry,
} from '@/features/threads/data/pull-request-entries'
import { currentBranchOf, isOutsideGit } from '@/features/threads/data/header-model'
import { UNTITLED } from '@/features/threads/data/untitled'
import { useSidebarPrObservation } from './shell-pr-observations'
import { ThreadStatusIcon } from './shell-status-icon'
import { useThreadFamily } from './shell-thread-family'
import { threadPullRequestsOf } from './thread-pull-requests'
import { PullRequestChecks, PullRequestConflict, PullRequestIcon } from './thread-pr-presentation'
import { threadStatusOf } from './thread-status'

export interface ThreadDetailsProps {
  thread: WireThread
  projectName: string
  teammates?: readonly WireThread[]
  teammateParents?: ReadonlyMap<string, WireThread> | undefined
  parent?: WireThread | undefined
  collapsed?: boolean
  states: readonly PrStateWire[]
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center justify-end gap-1.5 text-right break-words text-foreground">
        {children}
      </span>
    </div>
  )
}

function PullRequestDetails({ entries }: { entries: readonly PullRequestEntry[] }) {
  if (entries.length === 0) return <p className="text-xs text-muted-foreground">No pull requests</p>
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li
          key={`${entry.repo}#${entry.number}`}
          data-pr-detail="entry"
          className="flex min-w-0 flex-col gap-1.5 text-xs"
        >
          <div data-pr-detail="title" className="flex min-w-0 items-start gap-1.5">
            <PullRequestIcon entry={entry} />
            <a
              href={entry.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 break-words hover:underline"
            >
              {entry.repo}#{entry.number}
              {entry.title ? ` · ${entry.title}` : ''}
            </a>
          </div>
          <div
            data-pr-detail="metadata"
            className="flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground"
          >
            {entry.via ? (
              <span className="text-muted-foreground">
                From {entry.via.title ?? entry.via.threadId}
              </span>
            ) : null}
            <span className="text-muted-foreground">{entry.state ?? 'State unknown'}</span>
            <PullRequestConflict entry={entry} />
            <PullRequestChecks entry={entry} detailed />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function ThreadDetails({
  thread,
  projectName,
  teammates = [],
  teammateParents,
  parent,
  collapsed = false,
  states,
}: ThreadDetailsProps) {
  const family = useThreadFamily()
  const own = threadPullRequestsOf({ thread, teammates: [], collapsed: false, states, family })
  const teammateEntries = teammates.flatMap((teammate) =>
    threadPullRequestsOf({ thread: teammate, teammates: [], collapsed: false, states, family }),
  )
  const represented = new Set([...own, ...teammateEntries].map(pullRequestKeyOf))
  const borrowed = collapsed
    ? threadPullRequestsOf({ thread, teammates, collapsed: true, states, family }).filter(
        (entry) => !represented.has(pullRequestKeyOf(entry)),
      )
    : []
  const observationRef = useSidebarPrObservation(
    thread.runner === 'local' ? [] : [...own, ...teammateEntries, ...borrowed],
  )
  return (
    <section
      ref={observationRef}
      aria-label="Scrollable thread details"
      className="flex max-h-96 flex-col gap-2.5 overflow-y-auto outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-sm leading-snug font-medium break-words">{thread.title ?? UNTITLED}</p>
        <p className="text-xs text-muted-foreground">
          Created {relativeTime({ from: thread.createdAt })}, updated{' '}
          {relativeTime({ from: thread.updatedAt })}
        </p>
      </div>
      <Separator />
      <div className="flex flex-col gap-1.5">
        <DetailRow label="Run status">
          <ThreadStatusIcon status={threadStatusOf(thread)} />
          <span className="capitalize">{threadStatusOf(thread)}</span>
        </DetailRow>
        <DetailRow label="Model">
          <span className="break-all">{thread.model?.ref ?? 'Unknown'}</span>
        </DetailRow>
        <DetailRow label="Project">
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          {projectName}
        </DetailRow>
        {isOutsideGit(thread) ? null : (
          <DetailRow label="Branch">
            <span className="font-mono break-all">
              {currentBranchOf(thread) ?? 'No branch yet'}
            </span>
          </DetailRow>
        )}
        {parent ? (
          <DetailRow label="Teammate of">
            <Link href={`/threads/${encodeURIComponent(parent.id)}`} className="hover:underline">
              {parent.title ?? UNTITLED}
            </Link>
          </DetailRow>
        ) : null}
      </div>
      <h3 className="text-xs font-medium text-muted-foreground">Own pull requests</h3>
      <PullRequestDetails entries={own} />
      {collapsed && teammates.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Collapsed summary includes unique pull requests from this thread and its teammates below;
          teammate pull requests are not owned by this thread.
        </p>
      ) : null}
      {borrowed.length > 0 ? (
        <>
          <h3 className="text-xs font-medium text-muted-foreground">
            Pull requests from other threads
          </h3>
          <PullRequestDetails entries={borrowed} />
        </>
      ) : null}
      {teammates.length > 0 ? (
        <>
          <h3 className="text-xs font-medium text-muted-foreground">Teammates</h3>
          <ul className="flex flex-col gap-3">
            {teammates.map((teammate) => {
              const teammateParent = teammateParents?.get(teammate.id)
              return (
                <li key={teammate.id} className="flex flex-col gap-1.5">
                  <Link
                    href={`/threads/${encodeURIComponent(teammate.id)}`}
                    className="flex items-center gap-1.5 text-xs hover:underline"
                  >
                    <ThreadStatusIcon status={threadStatusOf(teammate)} />
                    <span className="min-w-0 break-words">
                      {teammate.title ? displayedThreadTitle(teammate.title) : UNTITLED}
                    </span>
                  </Link>
                  {teammateParent && teammateParent.id !== thread.id ? (
                    <p className="text-xs text-muted-foreground">
                      Teammate of {teammateParent.title ?? UNTITLED}
                    </p>
                  ) : null}
                  <PullRequestDetails
                    entries={threadPullRequestsOf({
                      thread: teammate,
                      teammates: [],
                      collapsed: false,
                      states,
                      family,
                    })}
                  />
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
    </section>
  )
}
