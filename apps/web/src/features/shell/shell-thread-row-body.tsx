import { Archive, ArchiveRestore, CircleCheck, Pin, RotateCcw } from 'lucide-react'
import Link from 'next/link'

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
import { EThreadStatus, isUnread, isWorking, threadStatusOf } from './thread-status'
import { v2SessionHref } from './v2-rows'
import { v2StatusIconOf, type V2RowView } from './v2-status'

export interface ThreadRowBodyProps {
  thread: WireThread
  projectName: string
  active: boolean
  teammates?: readonly WireThread[]
  teammateParents?: ReadonlyMap<string, WireThread>
  parent?: WireThread | undefined
  collapsed?: boolean
  v2?: boolean
  v2View?: V2RowView | undefined
  listedNaming?: boolean
}

export function ThreadRowBody({
  thread,
  projectName,
  active,
  teammates = [],
  teammateParents,
  parent,
  collapsed = false,
  v2 = false,
  v2View,
  listedNaming = false,
}: ThreadRowBodyProps) {
  const { onToggleArchive } = useThreadActions()
  const { density } = useSidebarDensity()
  const states = useSidebarPrStates()
  const compact = density === ESidebarDensity.Compact
  const family = useThreadFamily()
  const entries = v2
    ? v2View?.pullRequest === undefined
      ? []
      : [v2View.pullRequest]
    : threadPullRequestsOf({ thread, teammates, collapsed, states, family })
  const statusIcon = v2 ? v2StatusIconOf(v2View?.status) : threadStatusOf(thread)
  const branch = v2 ? v2View?.branch : currentBranchOf(thread)
  const working = v2 ? statusIcon === EThreadStatus.Running : isWorking(thread)
  const latest = latestThreadPullRequestOf(entries)
  const observationRef = useSidebarPrObservation(
    thread.runner !== 'local' && latest
      ? [
          {
            repo: latest.repo,
            number: latest.number,
            priority: EPrObservationPriority.Inline,
          },
        ]
      : [],
  )
  const pinned = thread.pinnedAt !== null && thread.pinnedAt !== undefined
  const archived = thread.archivedAt !== null && thread.archivedAt !== undefined
  const unread = isUnread({ thread, active })
  const naming = rowNamingOf({
    listedTitle: thread.title ?? null,
    listedNaming,
    published: useThreadNaming(thread.id),
  })
  const handleArchive = () => onToggleArchive(thread)
  const teammate = parent !== undefined
  const archiveLabel = teammate
    ? archived
      ? 'Reopen'
      : 'Mark as done'
    : archived
      ? 'Unarchive thread'
      : 'Archive thread'
  return (
    <ThreadHoverCard
      thread={thread}
      projectName={projectName}
      teammates={teammates}
      teammateParents={teammateParents}
      parent={parent}
      collapsed={collapsed}
      states={states}
      actions={
        <RowAction label={archiveLabel} onClick={handleArchive}>
          {teammate ? (
            archived ? (
              <RotateCcw />
            ) : (
              <CircleCheck />
            )
          ) : archived ? (
            <ArchiveRestore />
          ) : (
            <Archive />
          )}
        </RowAction>
      }
      indicator={
        pinned ? (
          <Pin
            role="img"
            aria-label="Pinned"
            className="mr-1 size-3 shrink-0 text-muted-foreground"
          />
        ) : null
      }
      className={cn(
        'group/thread @container relative grid min-w-0 w-full grid-cols-[minmax(0,1fr)_auto] items-start rounded-md hover:bg-sidebar-accent data-popup-open:bg-sidebar-accent',
        active && 'bg-sidebar-accent',
      )}
    >
      <Link
        ref={observationRef}
        href={v2 ? v2SessionHref(thread.id) : `/threads/${encodeURIComponent(thread.id)}`}
        aria-current={active ? 'page' : undefined}
        data-density={density}
        className={cn(
          'col-span-2 col-start-1 row-start-1 grid min-w-0 grid-cols-subgrid rounded-md text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:overflow-hidden',
          compact ? 'py-2' : 'py-1.5',
        )}
      >
        <span
          data-thread-line="primary"
          className="col-start-1 flex min-w-0 items-center gap-2 px-2"
        >
          {statusIcon === undefined ? null : (
            <ThreadStatusIcon status={statusIcon} unread={unread} />
          )}
          {compact ? (
            <span className="group-data-[collapsible=icon]:hidden">
              <CompactWorkIcon entries={entries} />
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:hidden">
            <NamingTitle
              title={naming.title}
              naming={naming.naming}
              className={cn('flex-1', working && 'shimmer motion-reduce:shimmer-none')}
            />
          </span>
          {v2 ? (
            <span
              data-engine-tag="v2"
              className="shrink-0 rounded-sm border px-1 font-mono text-[10px] leading-4 text-muted-foreground group-data-[collapsible=icon]:hidden"
            >
              v2
            </span>
          ) : null}
          {thread.runner === 'local' ? (
            <span className="group-data-[collapsible=icon]:hidden">
              <LocalPodIcon />
            </span>
          ) : null}
        </span>
        {!compact ? (
          <span
            data-thread-line="secondary"
            className="col-span-2 mt-1 flex min-w-0 items-center gap-1.5 px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden"
          >
            <ThreadWorkSummary entries={entries} branch={branch} />
            <time dateTime={thread.updatedAt} className="ml-auto shrink-0 font-mono">
              {relativeTime({ from: thread.updatedAt })}
            </time>
          </span>
        ) : null}
      </Link>
    </ThreadHoverCard>
  )
}
