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
import { groupTeammates, hasAttentionTeammate, teammateCountLabel } from './teammate-display'
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
        <span>{count} done</span>
      </button>
    </SidebarMenuSubItem>
  )
}

interface FolderToggleProps {
  open: boolean
  count: number
  attention: boolean
  onToggle: () => void
}

function FolderToggle({ open, count, attention, onToggle }: FolderToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} ${teammateCountLabel(count)}`}
      className="flex h-5 items-center gap-1 rounded-md px-1 text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      {open ? null : <span className="font-mono text-xs tabular-nums">{count}</span>}
      {open || !attention ? null : (
        <span className="size-1.5 rounded-full bg-warning">
          <span className="sr-only">Needs attention</span>
        </span>
      )}
      <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
    </button>
  )
}

export function ThreadFolder({
  thread,
  teammates,
  activeThreadId,
  defaultCardOpen,
}: ThreadFolderProps) {
  const { live, done } = groupTeammates(teammates)
  const holdsActive =
    thread.id === activeThreadId || teammates.some((teammate) => teammate.id === activeThreadId)
  const activeIsDone = done.some((teammate) => teammate.id === activeThreadId)
  const folder = useFollowActive(holdsActive)
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
        trailing={
          <FolderToggle
            open={folder.open}
            count={teammates.length}
            attention={hasAttentionTeammate(teammates)}
            onToggle={folder.handleToggle}
          />
        }
      />
      {folder.open ? (
        <SidebarMenuSub className="mr-0 ml-3.5 gap-0.5 pr-0 pl-2">
          {live.map(renderRow)}
          {done.length > 0 ? (
            <DoneToggle count={done.length} open={doneFold.open} onToggle={doneFold.handleToggle} />
          ) : null}
          {doneFold.open ? done.map(renderRow) : null}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  )
}
