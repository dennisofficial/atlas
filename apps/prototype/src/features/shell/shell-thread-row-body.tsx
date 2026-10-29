import { Archive, ArchiveRestore, ExternalLink, Pin } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { SidebarMenuButton } from '@dltech/atlas-ui/components/sidebar'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { type AppThread, EThreadStatus } from './fixtures/app'
import { RowAction } from './shell-row-action'
import { PRESENTATION, ThreadStatusIcon } from './shell-status-icon'
import { EStatusStyle } from './shell-tweaks'
import { useStatusStyle } from './use-status-style'
import { threadHref } from './thread-href'
import { useThreadActions } from './thread-actions-context'
import { ThreadHoverCard } from './thread-hover-card'

export interface ThreadRowBodyProps {
  thread: AppThread
  active: boolean
  defaultCardOpen: boolean
  trailing?: ReactNode
}

function hasPullRequest(thread: AppThread): boolean {
  return (
    thread.status === EThreadStatus.PrOpen ||
    thread.status === EThreadStatus.PrMerged ||
    thread.status === EThreadStatus.PrClosed
  )
}

const QUIET_LABEL = new Set([EThreadStatus.Idle])

function StatusTrailing({ thread, style }: { thread: AppThread; style: EStatusStyle }) {
  const unread = thread.unread === true
  if (style === EStatusStyle.Label) {
    if (QUIET_LABEL.has(thread.status) && !unread) return null
    return (
      <span className="flex shrink-0 items-center gap-1.5 pr-2 text-xs text-muted-foreground group-hover/thread:hidden">
        {QUIET_LABEL.has(thread.status) ? null : PRESENTATION[thread.status].label}
        {unread ? (
          <span role="img" aria-label="Unread" className="size-1.5 rounded-full bg-primary" />
        ) : null}
      </span>
    )
  }
  if (style === EStatusStyle.Dot && unread) {
    return (
      <span className="flex shrink-0 items-center pr-2.5 group-hover/thread:hidden">
        <span role="img" aria-label="Unread" className="size-1.5 rounded-full bg-primary" />
      </span>
    )
  }
  return null
}

export function ThreadRowBody({ thread, active, defaultCardOpen, trailing }: ThreadRowBodyProps) {
  const { onToggleArchive } = useThreadActions()
  const archived = thread.archived === true
  const handleArchive = () => onToggleArchive(thread.id)
  const style = useStatusStyle()
  const boldUnread = style === EStatusStyle.Bold && thread.unread === true && !active
  return (
    <ThreadHoverCard
      thread={thread}
      defaultOpen={defaultCardOpen}
      className={cn(
        'group/thread flex items-center rounded-md hover:bg-sidebar-accent data-popup-open:bg-sidebar-accent',
        active && 'bg-sidebar-accent',
      )}
    >
      <SidebarMenuButton
        isActive={active}
        size="sm"
        render={<Link href={threadHref(thread)} />}
        aria-current={active ? 'page' : undefined}
        className="h-7 min-w-0 flex-1 text-sm hover:bg-transparent data-active:bg-transparent"
      >
        <ThreadStatusIcon status={thread.status} />
        <span
          className={cn(
            boldUnread && 'font-semibold text-foreground',
            style === EStatusStyle.Bold && !boldUnread && !active && 'text-muted-foreground',
          )}
        >
          {thread.title}
        </span>
      </SidebarMenuButton>
      <StatusTrailing thread={thread} style={style} />
      <div className="hidden shrink-0 items-center pr-1 group-hover/thread:flex group-data-popup-open/thread:flex">
        <RowAction label="Pin thread">
          <Pin />
        </RowAction>
        <RowAction label={archived ? 'Unarchive thread' : 'Archive thread'} onClick={handleArchive}>
          {archived ? <ArchiveRestore /> : <Archive />}
        </RowAction>
        {hasPullRequest(thread) && (
          <RowAction label="Open pull request on GitHub">
            <ExternalLink />
          </RowAction>
        )}
      </div>
      {trailing ? <div className="flex shrink-0 items-center gap-1 pr-1">{trailing}</div> : null}
    </ThreadHoverCard>
  )
}
