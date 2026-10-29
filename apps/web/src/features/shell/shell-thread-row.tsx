import { Archive, ArchiveRestore, ExternalLink, Pin } from 'lucide-react'
import Link from 'next/link'

import { SidebarMenuButton, SidebarMenuItem } from '@dltech/atlas-ui/components/sidebar'
import { cn } from '@dltech/atlas-ui/lib/utils'
import type { WireThread } from '@dltech/atlas-wire/web'

import {
  pinnedPullRequestOf,
  pullRequestEntriesOf,
} from '@/features/threads/data/pull-request-entries'
import { UNTITLED } from '@/features/threads/data/untitled'

import { RowAction } from './shell-row-action'
import { ThreadStatusIcon } from './shell-status-icon'
import { useThreadActions } from './thread-actions-context'
import { ThreadHoverCard } from './thread-hover-card'
import { threadStatusOf } from './thread-status'

export interface ThreadRowProps {
  thread: WireThread
  projectName: string
  active: boolean
}

export function ThreadRow({ thread, projectName, active }: ThreadRowProps) {
  const pullRequest = pinnedPullRequestOf(pullRequestEntriesOf({ thread, states: [] }))
  const { onToggleArchive } = useThreadActions()
  const pinned = thread.pinnedAt !== null && thread.pinnedAt !== undefined
  const archived = thread.archivedAt !== null && thread.archivedAt !== undefined
  const handleArchive = () => onToggleArchive(thread)
  return (
    <SidebarMenuItem>
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
          <span>{thread.title ?? UNTITLED}</span>
        </SidebarMenuButton>
        {pinned ? (
          <Pin
            role="img"
            aria-label="Pinned"
            className="mr-2 size-3 shrink-0 text-muted-foreground group-hover/thread:hidden group-data-popup-open/thread:hidden"
          />
        ) : null}
        <div className="hidden shrink-0 items-center pr-1 group-hover/thread:flex group-data-popup-open/thread:flex">
          <RowAction
            label={archived ? 'Unarchive thread' : 'Archive thread'}
            onClick={handleArchive}
          >
            {archived ? <ArchiveRestore /> : <Archive />}
          </RowAction>
          {pullRequest === undefined ? null : (
            <RowAction label="Open pull request on GitHub" href={pullRequest.url} external>
              <ExternalLink />
            </RowAction>
          )}
        </div>
      </ThreadHoverCard>
    </SidebarMenuItem>
  )
}
