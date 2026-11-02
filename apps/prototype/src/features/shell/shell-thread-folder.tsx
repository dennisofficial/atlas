import { ChevronRight } from 'lucide-react'

import {
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
} from '@dltech/atlas-ui/components/sidebar'
import { cn } from '@dltech/atlas-ui/lib/utils'

import type { AppThread } from './fixtures/app'
import type { AppTeammate } from './fixtures/teammates'
import { TeammateRow } from './shell-teammate-row'
import { ThreadRowBody } from './shell-thread-row-body'
import { groupTeammates } from './teammate-display'
import { useFollowActive } from './use-follow-active'

export interface ThreadFolderProps {
  thread: AppThread
  teammates: AppTeammate[]
  activeThreadId?: string
  defaultCardOpen: boolean
}

interface DoneToggleProps {
  count: number
  open: boolean
  onToggle: () => void
}

function DoneToggle({ count, open, onToggle }: DoneToggleProps) {
  return (
    <SidebarMenuSubItem>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-sm text-muted-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <ChevronRight
          className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
        />
        <span className="shrink-0">Done</span>
        <span className="ml-auto font-mono text-xs tabular-nums">{count}</span>
      </button>
    </SidebarMenuSubItem>
  )
}

export function ThreadFolder({
  thread,
  teammates,
  activeThreadId,
  defaultCardOpen,
}: ThreadFolderProps) {
  const { active, done } = groupTeammates(teammates)
  const activeIsDone = done.some((teammate) => teammate.id === activeThreadId)
  const doneFold = useFollowActive(activeIsDone)

  const renderRow = (teammate: AppTeammate) => (
    <TeammateRow key={teammate.id} teammate={teammate} active={teammate.id === activeThreadId} />
  )

  return (
    <SidebarMenuItem>
      <ThreadRowBody
        thread={thread}
        active={thread.id === activeThreadId}
        defaultCardOpen={defaultCardOpen}
      />
      <SidebarMenuSub className="mr-0 ml-3.5 gap-0.5 pr-0 pl-2">
        {active.map(renderRow)}
        {done.length > 0 ? (
          <DoneToggle count={done.length} open={doneFold.open} onToggle={doneFold.handleToggle} />
        ) : null}
        {doneFold.open ? done.map(renderRow) : null}
      </SidebarMenuSub>
    </SidebarMenuItem>
  )
}
