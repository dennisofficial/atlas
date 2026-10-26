import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { SidebarGroup, SidebarMenu } from '@dltech/atlas-ui/components/sidebar'

import { BUCKETS, PROJECTS, threadsOf, type AppProject, type AppThread } from './fixtures/app'
import { Bucket, type BucketEntry } from './shell-bucket'
import { ProjectGroup } from './shell-project-group'
import { ThreadRow } from './shell-thread-row'
import { ThreadActionsContext } from './thread-actions-context'

export interface ThreadListProps {
  activeThreadId?: string
  threadCardId?: string
  projectCardId?: string
  pendingThread?: AppThread
  archivedThreadIds?: string[]
  archivedBucketOpen?: boolean
}

const NO_PROJECT: AppProject = { id: 'no-project', owner: '', name: 'No project' }

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
  archivedThreadIds = [],
  archivedBucketOpen = false,
}: ThreadListProps) {
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [archivedIds, setArchivedIds] = useState<string[]>(archivedThreadIds)

  const handleToggleArchive = (threadId: string) => {
    setArchivedIds((current) =>
      current.includes(threadId) ? current.filter((id) => id !== threadId) : [...current, threadId],
    )
  }
  const actions = { onToggleArchive: handleToggleArchive }

  const withFlag = (thread: AppThread): AppThread => ({
    ...thread,
    archived: archivedIds.includes(thread.id),
  })
  const projectThreads = (projectId: string): AppThread[] =>
    threadsFor({ projectId, pendingThread }).map(withFlag)
  const archivedEntries: BucketEntry[] = [
    ...(pendingThread?.projectId === null
      ? [{ project: NO_PROJECT, threads: [withFlag(pendingThread)] }]
      : []),
    ...PROJECTS.map((project) => ({ project, threads: projectThreads(project.id) })),
  ]
    .map(({ project, threads }) => ({
      project,
      threads: threads.filter((thread) => thread.archived),
    }))
    .filter((entry) => entry.threads.length > 0)

  const handleOpenChange = (projectId: string, open: boolean) => {
    setCollapsed((current) =>
      open ? current.filter((id) => id !== projectId) : [...current, projectId],
    )
  }

  const unprojected =
    pendingThread?.projectId === null && !archivedIds.includes(pendingThread.id)
      ? [withFlag(pendingThread)]
      : []

  return (
    <ThreadActionsContext.Provider value={actions}>
      <SidebarGroup className="gap-3 px-2 py-2">
        {unprojected.length > 0 ? (
          <SidebarMenu aria-label="Threads without a project" className="gap-0.5">
            {unprojected.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                activeThreadId={activeThreadId}
                defaultCardOpen={thread.id === threadCardId}
              />
            ))}
          </SidebarMenu>
        ) : null}
        {PROJECTS.map((project) => (
          <ProjectGroup
            key={project.id}
            project={project}
            threads={projectThreads(project.id).filter((thread) => !thread.archived)}
            open={!collapsed.includes(project.id)}
            onOpenChange={(open) => handleOpenChange(project.id, open)}
            activeThreadId={activeThreadId}
            threadCardId={threadCardId}
            defaultCardOpen={project.id === projectCardId}
          />
        ))}
        <div className="flex flex-col gap-0.5">
          <BucketRow label="Inactive" hint="Last 72h" count={BUCKETS.inactive} />
          {archivedEntries.length > 0 && (
            <Bucket
              label="Archived"
              entries={archivedEntries}
              activeThreadId={activeThreadId}
              threadCardId={threadCardId}
              defaultOpen={archivedBucketOpen}
            />
          )}
        </div>
      </SidebarGroup>
    </ThreadActionsContext.Provider>
  )
}
