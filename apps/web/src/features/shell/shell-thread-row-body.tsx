import { Archive, ArchiveRestore, Pin } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { NamingTitle } from '@dltech/atlas-ui/ai/naming-title'
import { SidebarMenuButton } from '@dltech/atlas-ui/components/sidebar'
import { cn } from '@dltech/atlas-ui/lib/utils'
import type { WireThread } from '@dltech/atlas-wire/web'

import { rowNamingOf, useThreadNaming } from './active-naming'
import { LocalPodIcon } from '@/features/threads/thread-header'
import { RowAction } from './shell-row-action'
import { ThreadStatusIcon } from './shell-status-icon'
import { useThreadActions } from './thread-actions-context'
import { ThreadHoverCard } from './thread-hover-card'
import { isUnread, isWorking, threadStatusOf } from './thread-status'
import { UnreadDot } from './unread-dot'

export interface ThreadRowBodyProps {
  thread: WireThread
  projectName: string
  active: boolean
  trailing?: ReactNode
}

export function ThreadRowBody({ thread, projectName, active, trailing }: ThreadRowBodyProps) {
  const { onToggleArchive } = useThreadActions()
  const pinned = thread.pinnedAt !== null && thread.pinnedAt !== undefined
  const archived = thread.archivedAt !== null && thread.archivedAt !== undefined
  const naming = rowNamingOf({
    listedTitle: thread.title ?? null,
    published: useThreadNaming(thread.id),
  })
  const handleArchive = () => onToggleArchive(thread)
  return (
    <ThreadHoverCard
      thread={thread}
      projectName={projectName}
      className={cn(
        'group/thread flex items-center rounded-md hover:bg-sidebar-accent data-popup-open:bg-sidebar-accent',
        active && 'bg-sidebar-accent',
      )}
    >
      <SidebarMenuButton
        isActive={active}
        size="sm"
        render={<Link href={`/threads/${encodeURIComponent(thread.id)}`} />}
        className="min-w-0 flex-1 text-sm"
      >
        <ThreadStatusIcon status={threadStatusOf(thread)} />
        <NamingTitle
          title={naming.title}
          naming={naming.naming}
          className={cn(isWorking(thread) && 'shimmer motion-reduce:shimmer-none')}
        />
        {thread.runner === 'local' ? <LocalPodIcon /> : null}
      </SidebarMenuButton>
      {isUnread({ thread, active }) ? <UnreadDot /> : null}
      {trailing}
      {pinned ? (
        <Pin
          role="img"
          aria-label="Pinned"
          className="mr-2 size-3 shrink-0 text-muted-foreground group-hover/thread:hidden group-data-popup-open/thread:hidden"
        />
      ) : null}
      <div className="hidden shrink-0 items-center pr-1 group-hover/thread:flex group-data-popup-open/thread:flex pointer-coarse:flex">
        <RowAction label={archived ? 'Unarchive thread' : 'Archive thread'} onClick={handleArchive}>
          {archived ? <ArchiveRestore /> : <Archive />}
        </RowAction>
      </div>
    </ThreadHoverCard>
  )
}
