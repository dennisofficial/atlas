import { Archive, ArchiveRestore, ExternalLink, Pin } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { SidebarMenuButton } from '@dltech/atlas-ui/components/sidebar'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { type AppThread, EThreadStatus } from './fixtures/app'
import { RowAction } from './shell-row-action'
import { PrStateIcon, RunStatusIcon } from './shell-status-icon'
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

export function ThreadRowBody({ thread, active, defaultCardOpen, trailing }: ThreadRowBodyProps) {
  const { onToggleArchive } = useThreadActions()
  const archived = thread.archived === true
  const handleArchive = () => onToggleArchive(thread.id)
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
        <RunStatusIcon status={thread.status} unread={thread.unread === true} />
        <PrStateIcon status={thread.status} />
        <span>{thread.title}</span>
      </SidebarMenuButton>
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
