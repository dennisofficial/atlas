import { Archive, ArchiveRestore, Pin } from 'lucide-react'
import Link from 'next/link'
import type { MouseEvent, ReactNode } from 'react'

import { NamingTitle } from '@dltech/atlas-ui/ai/naming-title'
import { cn } from '@dltech/atlas-ui/lib/utils'
import type { WireThread } from '@dltech/atlas-wire/web'
import { relativeTime } from '@/features/settings/data/personal/relative-time'
import { currentBranchOf } from '@/features/threads/data/header-model'
import { EPrObservationPriority } from '@/features/threads/data/pr-observation-targets'
import { LocalPodIcon } from '@/features/threads/thread-header'
import { rowNamingOf, useThreadNaming } from './active-naming'
import { ESidebarDensity, useSidebarDensity } from './shell-density'
import { useSidebarPrObservation } from './shell-pr-observations'
import { RowAction } from './shell-row-action'
import { useSidebarPrStates } from './shell-sidebar-pr-states'
import { ThreadStatusIcon } from './shell-status-icon'
import { useThreadFamily } from './shell-thread-family'
import { useThreadActions } from './thread-actions-context'
import { ThreadHoverCard } from './thread-hover-card'
import { latestThreadPullRequestOf, threadPullRequestsOf } from './thread-pull-requests'
import { CompactWorkIcon, ThreadWorkSummary } from './thread-pr-presentation'
import { isUnread, isWorking, threadStatusOf } from './thread-status'

export interface ThreadRowBodyProps {
  thread: WireThread
  projectName: string
  active: boolean
  trailing?: ReactNode
  teammates?: readonly WireThread[]
  teammateParents?: ReadonlyMap<string, WireThread>
  parent?: WireThread | undefined
  collapsed?: boolean
  onSelect?: (() => void) | undefined
}

export function ThreadRowBody({
  thread,
  projectName,
  active,
  trailing,
  teammates = [],
  teammateParents,
  parent,
  collapsed = false,
  onSelect,
}: ThreadRowBodyProps) {
  const { onToggleArchive } = useThreadActions()
  const { density } = useSidebarDensity()
  const states = useSidebarPrStates()
  const compact = density === ESidebarDensity.Compact
  const family = useThreadFamily()
  const entries = threadPullRequestsOf({ thread, teammates, collapsed, states, family })
  const latest = latestThreadPullRequestOf(entries)
  const observationRef = useSidebarPrObservation(
    thread.runner !== 'local' && latest
      ? [{ repo: latest.repo, number: latest.number, priority: EPrObservationPriority.Inline }]
      : [],
  )
  const pinned = thread.pinnedAt !== null && thread.pinnedAt !== undefined
  const archived = thread.archivedAt !== null && thread.archivedAt !== undefined
  const unread = isUnread({ thread, active })
  const naming = rowNamingOf({
    listedTitle: thread.title ?? null,
    published: useThreadNaming(thread.id),
  })
  const handleArchive = () => onToggleArchive(thread)
  const handleSelect = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey)
      onSelect?.()
  }
  return (
    <ThreadHoverCard
      thread={thread}
      projectName={projectName}
      teammates={teammates}
      teammateParents={teammateParents}
      parent={parent}
      collapsed={collapsed}
      states={states}
      hasDisclosure={Boolean(trailing)}
      actions={
        <RowAction label={archived ? 'Unarchive thread' : 'Archive thread'} onClick={handleArchive}>
          {archived ? <ArchiveRestore /> : <Archive />}
        </RowAction>
      }
      className={cn(
        'group/thread @container relative flex min-w-0 w-full items-start rounded-md hover:bg-sidebar-accent data-popup-open:bg-sidebar-accent',
        active && 'bg-sidebar-accent',
      )}
    >
      <Link
        ref={observationRef}
        href={`/threads/${encodeURIComponent(thread.id)}`}
        aria-current={active ? 'page' : undefined}
        onClick={handleSelect}
        data-density={density}
        className={cn(
          'block min-w-0 flex-1 rounded-md px-2 group-hover/thread:[&_[data-thread-line=primary]]:pr-12 group-focus-within/thread:[&_[data-thread-line=primary]]:pr-12 pointer-coarse:[&_[data-thread-line=primary]]:pr-12 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:overflow-hidden',
          compact ? 'py-2' : 'py-1.5',
        )}
      >
        <span data-thread-line="primary" className="flex min-w-0 items-center gap-2">
          <ThreadStatusIcon status={threadStatusOf(thread)} unread={unread} />
          {compact ? (
            <span className="group-data-[collapsible=icon]:hidden">
              <CompactWorkIcon entries={entries} />
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:hidden">
            <NamingTitle
              title={naming.title}
              naming={naming.naming}
              className={cn('flex-1', isWorking(thread) && 'shimmer motion-reduce:shimmer-none')}
            />
          </span>
          {thread.runner === 'local' ? (
            <span className="group-data-[collapsible=icon]:hidden">
              <LocalPodIcon />
            </span>
          ) : null}
        </span>
        {!compact ? (
          <span
            data-thread-line="secondary"
            className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden"
          >
            <ThreadWorkSummary entries={entries} branch={currentBranchOf(thread)} />
            <time dateTime={thread.updatedAt} className="ml-auto shrink-0 font-mono">
              {relativeTime({ from: thread.updatedAt })}
            </time>
          </span>
        ) : null}
      </Link>
      <div className="flex shrink-0 items-center pt-1 group-data-[collapsible=icon]:hidden">
        {trailing}
        {pinned ? (
          <Pin
            role="img"
            aria-label="Pinned"
            className="mr-1 size-3 shrink-0 text-muted-foreground group-hover/thread:hidden group-focus-within/thread:hidden group-data-popup-open/thread:hidden"
          />
        ) : null}
      </div>
    </ThreadHoverCard>
  )
}
