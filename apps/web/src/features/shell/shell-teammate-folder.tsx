import { ChevronRight } from 'lucide-react'

import { SidebarMenuSub, SidebarMenuSubItem } from '@dltech/atlas-ui/components/sidebar'
import { cn } from '@dltech/atlas-ui/lib/utils'
import type { WireThread } from '@dltech/atlas-wire/web'

import { TeammateRow } from './shell-teammate-row'
import { groupTeammates, hasAttentionTeammate, teammateCountLabel } from './teammate-display'
import { useFollowActive } from './use-follow-active'

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

export interface FolderToggleProps {
  open: boolean
  teammates: readonly WireThread[]
  onToggle: () => void
}

export function FolderToggle({ open, teammates, onToggle }: FolderToggleProps) {
  const attention = !open && hasAttentionTeammate(teammates)
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} ${teammateCountLabel(teammates.length)}`}
      className="flex h-5 items-center gap-1 rounded-md px-1 text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      {open ? null : <span className="font-mono text-xs tabular-nums">{teammates.length}</span>}
      {attention ? (
        <span className="size-1.5 rounded-full bg-warning">
          <span className="sr-only">Needs attention</span>
        </span>
      ) : null}
      <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
    </button>
  )
}

export interface TeammateListProps {
  teammates: readonly WireThread[]
  activeThreadId: string | null
}

export function TeammateList({ teammates, activeThreadId }: TeammateListProps) {
  const { live, done } = groupTeammates(teammates)
  const doneFold = useFollowActive(done.some((teammate) => teammate.id === activeThreadId))
  const renderRow = (teammate: WireThread) => (
    <TeammateRow key={teammate.id} teammate={teammate} active={teammate.id === activeThreadId} />
  )
  return (
    <SidebarMenuSub>
      {live.map(renderRow)}
      {done.length > 0 ? (
        <DoneToggle count={done.length} open={doneFold.open} onToggle={doneFold.handleToggle} />
      ) : null}
      {doneFold.open ? done.map(renderRow) : null}
    </SidebarMenuSub>
  )
}
