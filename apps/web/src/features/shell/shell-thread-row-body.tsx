import { Archive, ArchiveRestore, CalendarClock, CircleCheck, Pin, RotateCcw } from 'lucide-react'
import Link from 'next/link'

import { ESandboxProvider } from '@dltech/atlas-protocol'
import { NamingTitle } from '@dltech/atlas-ui/ai/naming-title'
import { Badge } from '@dltech/atlas-ui/components/badge'
import { cn } from '@dltech/atlas-ui/lib/utils'
import type { WireThread } from '@dltech/atlas-wire/web'
import { relativeTime } from '@/features/settings/data/personal/relative-time'
import { currentBranchOf } from '@/features/threads/data/header-model'
import { RenameAction } from './rename-action'
import { rowNamingOf, useThreadNaming } from './active-naming'
import { ESidebarDensity, useSidebarDensity } from './shell-density'
import { RowAction } from './shell-row-action'
import { useSidebarPrStates } from './shell-sidebar-pr-states'
import { ThreadStatusIcon } from './shell-status-icon'
import { useThreadFamily } from './shell-thread-family'
import { useThreadActions } from './thread-actions-context'
import { ThreadHoverCard } from './thread-hover-card'
import { latestThreadPullRequestOf, threadPullRequestsOf } from './thread-pull-requests'
import { PullRequestMergeMarker } from '@/features/threads/pull-request-merge-marker'
import { CompactWorkIcon, ThreadWorkSummary } from './thread-pr-presentation'
import { EThreadStatus, isUnread, isWorking, threadStatusOf } from './thread-status'
import { sessionHref } from './session-rows'
import { isSessionUnread, statusIconOf, type RowView } from './row-status'

const MARKER_CLASS =
  'h-4 shrink-0 px-1 font-mono text-[10px] font-normal text-muted-foreground group-data-[collapsible=icon]:hidden'

export interface ThreadRowBodyProps {
  thread: WireThread
  projectName: string
  active: boolean
  teammates?: readonly WireThread[]
  teammateParents?: ReadonlyMap<string, WireThread>
  parent?: WireThread | undefined
  collapsed?: boolean
  view?: RowView | undefined
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
  view,
  listedNaming = false,
}: ThreadRowBodyProps) {
  const { onToggleArchive } = useThreadActions()
  const { density } = useSidebarDensity()
  const states = useSidebarPrStates()
  const compact = density === ESidebarDensity.Compact
  const family = useThreadFamily()
  const entries =
    view === undefined
      ? threadPullRequestsOf({ thread, teammates, collapsed, states, family })
      : view.pullRequest === undefined
        ? []
        : [view.pullRequest]
  const statusIcon = view === undefined ? threadStatusOf(thread) : statusIconOf(view)
  const branch = view === undefined ? currentBranchOf(thread) : view.branch
  const working = view === undefined ? isWorking(thread) : statusIcon === EThreadStatus.Running
  const latest = latestThreadPullRequestOf(entries)
  const pinned = thread.pinnedAt !== null && thread.pinnedAt !== undefined
  const archived = thread.archivedAt !== null && thread.archivedAt !== undefined
  const unread =
    view === undefined ? isUnread({ thread, active }) : isSessionUnread({ view, active })
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
        <>
          {view === undefined ? null : <RenameAction sessionId={thread.id} title={naming.title} />}
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
        </>
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
        'group/thread @container relative my-0.5 grid min-w-0 w-full grid-cols-[minmax(0,1fr)_auto] items-start rounded-lg hover:bg-sidebar-accent/50 data-popup-open:bg-sidebar-accent/50 has-[[data-popup-open]]:bg-sidebar-accent/50',
        active &&
          'bg-sidebar-accent hover:bg-sidebar-accent data-popup-open:bg-sidebar-accent has-[[data-popup-open]]:bg-sidebar-accent',
      )}
    >
      <Link
        href={
          view === undefined ? `/threads/${encodeURIComponent(thread.id)}` : sessionHref(thread.id)
        }
        aria-current={active ? 'page' : undefined}
        data-density={density}
        className={cn(
          'col-span-2 col-start-1 row-start-1 grid min-w-0 grid-cols-subgrid rounded-lg text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:overflow-hidden',
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
          {compact && latest !== undefined ? (
            <span className="inline-flex group-data-[collapsible=icon]:hidden">
              <PullRequestMergeMarker entry={latest} />
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:hidden">
            <NamingTitle
              title={naming.title}
              naming={naming.naming}
              className={cn('flex-1', working && 'shimmer motion-reduce:shimmer-none')}
            />
          </span>
          {view?.sandboxProvider === ESandboxProvider.Vercel ? (
            <Badge variant="outline" data-sandbox-provider="vercel" className={MARKER_CLASS}>
              Vercel
            </Badge>
          ) : null}
          {view?.routineId === undefined ? null : (
            <CalendarClock
              data-engine-tag="routine"
              role="img"
              aria-label="Routine"
              className="size-3.5 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden"
            />
          )}
        </span>
        {!compact ? (
          <span
            data-thread-line="secondary"
            className="col-span-2 mt-1 flex min-w-0 items-center gap-1.5 px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden"
          >
            {view !== undefined && branch === undefined && latest === undefined ? null : (
              <ThreadWorkSummary entries={entries} branch={branch} />
            )}
            <time dateTime={thread.updatedAt} className="ml-auto shrink-0 font-mono">
              {relativeTime({ from: thread.updatedAt })}
            </time>
          </span>
        ) : null}
      </Link>
    </ThreadHoverCard>
  )
}
