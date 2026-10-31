import { ChevronRight } from 'lucide-react'

import { SidebarMenuSub } from '@dltech/atlas-ui/components/sidebar'
import { cn } from '@dltech/atlas-ui/lib/utils'
import type { WireThread } from '@dltech/atlas-wire/web'

import { TeammateRow } from './shell-teammate-row'
import { groupTeammates, hasAttentionTeammate, teammateCountLabel } from './teammate-display'

export interface FolderToggleProps {
  open: boolean
  teammates: readonly WireThread[]
  controls: string
  onToggle: () => void
}

export function FolderToggle({ open, teammates, controls, onToggle }: FolderToggleProps) {
  const attention = !open && hasAttentionTeammate(teammates)
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={`${open ? 'Hide' : 'Show'} ${teammateCountLabel(teammates.length)}`}
      className="flex h-6 items-center gap-1 rounded-md px-1 text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      <span className="font-mono text-xs tabular-nums">{teammates.length}</span>
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
  parents: ReadonlyMap<string, WireThread>
  projectName: string
  activeThreadId: string | null
}

export function TeammateList({
  teammates,
  parents,
  projectName,
  activeThreadId,
}: TeammateListProps) {
  const { live, done } = groupTeammates(teammates)
  return (
    <SidebarMenuSub>
      {[...live, ...done].map((teammate) => (
        <TeammateRow
          key={teammate.id}
          teammate={teammate}
          parent={parents.get(teammate.id)}
          projectName={projectName}
          active={teammate.id === activeThreadId}
        />
      ))}
    </SidebarMenuSub>
  )
}
