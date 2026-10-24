import { ExternalLink, Pin } from 'lucide-react'
import Link from 'next/link'

import { SidebarMenuButton, SidebarMenuItem } from '@dltech/atlas-ui/components/sidebar'
import { cn } from '@dltech/atlas-ui/lib/utils'
import type { WireThread } from '@dltech/atlas-wire/web'

import { UNTITLED } from '@/features/threads/data/untitled'

import { RowAction } from './shell-row-action'
import { ThreadStatusIcon } from './shell-status-icon'
import { ThreadHoverCard } from './thread-hover-card'
import { linkedPullRequestOf, threadStatusOf } from './thread-status'

export interface ThreadRowProps {
  thread: WireThread
  projectName: string
  active: boolean
}

export function ThreadRow({ thread, projectName, active }: ThreadRowProps) {
  const pullRequest = linkedPullRequestOf(thread)
  const pinned = thread.pinnedAt !== null && thread.pinnedAt !== undefined
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
          className="h-7 min-w-0 flex-1 text-sm hover:bg-transparent data-active:bg-transparent"
        >
          <ThreadStatusIcon status={threadStatusOf(thread)} />
          <span>{thread.title ?? UNTITLED}</span>
        </SidebarMenuButton>
        {pinned ? (
          <Pin
            role="img"
            aria-label="Pinned"
            className="mr-2 size-3 shrink-0 text-muted-foreground"
          />
        ) : null}
        {pullRequest === undefined ? null : (
          <div className="hidden shrink-0 items-center pr-1 group-hover/thread:flex group-data-popup-open/thread:flex">
            <RowAction label="Open pull request on GitHub" href={pullRequest.url} external>
              <ExternalLink />
            </RowAction>
          </div>
        )}
      </ThreadHoverCard>
    </SidebarMenuItem>
  )
}
