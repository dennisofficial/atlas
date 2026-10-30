import { ChevronRight, FolderGit2, FolderX, SquarePen } from 'lucide-react'
import type { ReactNode } from 'react'

import { SidebarMenu } from '@dltech/atlas-ui/components/sidebar'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { ProjectHoverCard } from './project-hover-card'
import { RowAction } from './shell-row-action'
import { ThreadRow } from './shell-thread-row'
import { projectNameOf, type ProjectThreads } from './thread-partition'

const HEADER_CLASS =
  'group/project flex h-7 items-center gap-1.5 rounded-md px-2 hover:bg-sidebar-accent data-popup-open:bg-sidebar-accent'

function GroupHeader({ entry, children }: { entry: ProjectThreads; children: ReactNode }) {
  if (entry.project === null) return <div className={HEADER_CLASS}>{children}</div>
  return (
    <ProjectHoverCard project={entry.project} className={HEADER_CLASS}>
      {children}
    </ProjectHoverCard>
  )
}

export interface ProjectGroupProps {
  entry: ProjectThreads
  open: boolean
  onOpenChange: (open: boolean) => void
  activeThreadId: string | null
}

export function ProjectGroup({ entry, open, onOpenChange, activeThreadId }: ProjectGroupProps) {
  const { project, sessions } = entry
  const handleToggle = () => onOpenChange(!open)
  return (
    <section className="flex flex-col gap-0.5">
      <GroupHeader entry={entry}>
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-1.5 text-sm font-medium outline-hidden"
        >
          {project === null ? (
            <FolderX className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{projectNameOf(project)}</span>
        </button>
        <span className="h-px min-w-3 flex-1 bg-sidebar-border" />
        <div className="hidden shrink-0 items-center gap-1 group-hover/project:flex group-data-popup-open/project:flex pointer-coarse:flex">
          {project !== null && (
            <RowAction
              label="New thread in project"
              href={`/threads/new?project=${encodeURIComponent(project.id)}`}
            >
              <SquarePen />
            </RowAction>
          )}
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {sessions.length}
          </span>
          <button
            type="button"
            onClick={handleToggle}
            aria-label={open ? 'Collapse project' : 'Expand project'}
            className="flex size-5 items-center justify-center rounded-md text-muted-foreground outline-hidden hover:text-foreground"
          >
            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          </button>
        </div>
      </GroupHeader>
      {open && (
        <SidebarMenu>
          {sessions.map((session) => (
            <ThreadRow
              key={session.id}
              session={session}
              projectName={projectNameOf(project)}
              activeThreadId={activeThreadId}
            />
          ))}
        </SidebarMenu>
      )}
    </section>
  )
}
