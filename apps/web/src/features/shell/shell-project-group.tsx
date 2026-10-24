import { ChevronRight, FolderGit2, SquarePen } from 'lucide-react'

import { SidebarMenu } from '@dltech/atlas-ui/components/sidebar'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { ProjectHoverCard } from './project-hover-card'
import { RowAction } from './shell-row-action'
import { ThreadRow } from './shell-thread-row'
import type { ProjectThreads } from './thread-partition'

export interface ProjectGroupProps {
  entry: ProjectThreads
  open: boolean
  onOpenChange: (open: boolean) => void
  activeThreadId: string | null
}

export function ProjectGroup({ entry, open, onOpenChange, activeThreadId }: ProjectGroupProps) {
  const { project, threads } = entry
  const handleToggle = () => onOpenChange(!open)
  return (
    <section className="flex flex-col gap-0.5">
      <ProjectHoverCard
        project={project}
        className="group/project flex h-7 items-center gap-1.5 rounded-md px-2 hover:bg-sidebar-accent data-popup-open:bg-sidebar-accent"
      >
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-1.5 text-sm font-medium outline-hidden"
        >
          <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{project.name}</span>
        </button>
        <span className="h-px min-w-3 flex-1 bg-sidebar-border" />
        <div className="hidden shrink-0 items-center gap-1 group-hover/project:flex group-data-popup-open/project:flex">
          <RowAction
            label="New thread in project"
            href={`/threads/new?project=${encodeURIComponent(project.id)}`}
          >
            <SquarePen />
          </RowAction>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {threads.length}
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
      </ProjectHoverCard>
      {open && (
        <SidebarMenu className="gap-0.5">
          {threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              projectName={project.name}
              active={thread.id === activeThreadId}
            />
          ))}
        </SidebarMenu>
      )}
    </section>
  )
}
