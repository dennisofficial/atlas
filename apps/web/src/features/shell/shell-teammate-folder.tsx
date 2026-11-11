import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { SidebarMenuSub, SidebarMenuSubItem } from '@dltech/atlas-ui/components/sidebar'
import { cn } from '@dltech/atlas-ui/lib/utils'
import type { WireThread } from '@dltech/atlas-wire/web'
import type { SessionNode } from '@/features/threads/data/threads-api'

import { TeammateRow } from './shell-teammate-row'
import { groupTeammates } from './teammate-display'

export interface TeammateListProps {
  sessions: readonly SessionNode[]
  parent: WireThread
  projectName: string
  activeThreadId: string | null
}

function DoneToggle({
  count,
  open,
  onToggle,
}: {
  count: number
  open: boolean
  onToggle: () => void
}) {
  return (
    <SidebarMenuSubItem>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
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

export function TeammateList({ sessions, parent, projectName, activeThreadId }: TeammateListProps) {
  const { active, done } = groupTeammates(sessions.map((session) => session.mainThread))
  const [doneOpen, setDoneOpen] = useState(
    () => activeThreadId !== null && done.some((teammate) => teammate.id === activeThreadId),
  )
  const handleDoneToggle = () => setDoneOpen((current) => !current)
  const nodes = new Map(sessions.map((session) => [session.mainThread.id, session]))
  const rowFor = (teammate: WireThread) => {
    const session = nodes.get(teammate.id)
    if (!session) return null
    return (
      <TeammateRow
        key={teammate.id}
        session={session}
        parent={parent}
        projectName={projectName}
        activeThreadId={activeThreadId}
      />
    )
  }
  return (
    <SidebarMenuSub className="mr-0 ml-3.5 gap-0.5 pr-0 pl-2">
      {active.map(rowFor)}
      {done.length > 0 ? (
        <DoneToggle count={done.length} open={doneOpen} onToggle={handleDoneToggle} />
      ) : null}
      {doneOpen ? done.map(rowFor) : null}
    </SidebarMenuSub>
  )
}
