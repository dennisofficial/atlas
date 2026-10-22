import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { SidebarGroup, SidebarMenu } from '@dltech/atlas-ui/components/sidebar'

import { BUCKETS, PROJECTS, threadsOf, type AppThread } from '../../fixtures/app'
import { ProjectGroup } from './shell-project-group'
import { ThreadRow } from './shell-thread-row'

export interface ThreadListProps {
  activeThreadId?: string
  threadCardId?: string
  projectCardId?: string
  pendingThread?: AppThread
}

function BucketRow({ label, hint, count }: { label: string; hint?: string; count: number }) {
  return (
    <button
      type="button"
      className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <ChevronRight className="size-4 shrink-0" />
      <span className="shrink-0">{label}</span>
      {hint && <span className="shrink-0 text-xs opacity-70">{hint}</span>}
      <span className="h-px min-w-3 flex-1 bg-sidebar-border" />
      <span className="font-mono text-xs tabular-nums">{count}</span>
    </button>
  )
}

function threadsFor({
  projectId,
  pendingThread,
}: {
  projectId: string
  pendingThread?: AppThread
}): AppThread[] {
  const threads = threadsOf(projectId)
  return pendingThread?.projectId === projectId ? [pendingThread, ...threads] : threads
}

export function ThreadList({
  activeThreadId,
  threadCardId,
  projectCardId,
  pendingThread,
}: ThreadListProps) {
  const [collapsed, setCollapsed] = useState<string[]>([])

  const handleOpenChange = (projectId: string, open: boolean) => {
    setCollapsed((current) =>
      open ? current.filter((id) => id !== projectId) : [...current, projectId],
    )
  }

  const unprojected = pendingThread?.projectId === null ? [pendingThread] : []

  return (
    <SidebarGroup className="gap-3 px-2 py-2">
      {unprojected.length > 0 ? (
        <SidebarMenu aria-label="Threads without a project" className="gap-0.5">
          {unprojected.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              active={thread.id === activeThreadId}
              defaultCardOpen={thread.id === threadCardId}
            />
          ))}
        </SidebarMenu>
      ) : null}
      {PROJECTS.map((project) => (
        <ProjectGroup
          key={project.id}
          project={project}
          threads={threadsFor({ projectId: project.id, pendingThread })}
          open={!collapsed.includes(project.id)}
          onOpenChange={(open) => handleOpenChange(project.id, open)}
          activeThreadId={activeThreadId}
          threadCardId={threadCardId}
          defaultCardOpen={project.id === projectCardId}
        />
      ))}
      <div className="flex flex-col gap-0.5">
        <BucketRow label="Inactive" hint="Last 72h" count={BUCKETS.inactive} />
        <BucketRow label="Archived" count={BUCKETS.archived} />
      </div>
    </SidebarGroup>
  )
}
