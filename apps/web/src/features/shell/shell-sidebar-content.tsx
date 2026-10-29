import { useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'

import { SidebarGroup } from '@dltech/atlas-ui/components/sidebar'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

import { LoadFailed } from '@/features/settings/data/shared/query-gate'
import { setThreadArchived } from '@/features/threads/data/threads-api'
import { EQueryState, type CloudQuery } from '@/lib/use-cloud-query'

import { ThreadList } from './shell-thread-list'
import { ThreadActionsContext } from './thread-actions-context'
import type { ProjectThreads } from './thread-partition'
import { useThreadArchive } from './use-thread-archive'

const SKELETON_ROWS = ['one', 'two', 'three', 'four', 'five']

function ThreadsSkeleton() {
  return (
    <SidebarGroup role="status" aria-label="Loading threads">
      <div className="flex flex-col gap-2">
        {SKELETON_ROWS.map((row) => (
          <Skeleton key={row} className="h-7 w-full" />
        ))}
      </div>
    </SidebarGroup>
  )
}

export function ShellSidebarContent({
  query,
  activeThreadId,
}: {
  query: CloudQuery<ProjectThreads[]>
  activeThreadId: string | null
}) {
  const router = useRouter()
  const handleArchived = useCallback(
    (threadId: string) => {
      if (threadId === activeThreadId) router.replace('/threads')
    },
    [activeThreadId, router],
  )
  const { entries, handleToggleArchive } = useThreadArchive({
    entries: query.data,
    reload: query.reload,
    onArchived: handleArchived,
    archive: setThreadArchived,
  })
  const actions = useMemo(() => ({ onToggleArchive: handleToggleArchive }), [handleToggleArchive])

  if (query.state === EQueryState.Loading) return <ThreadsSkeleton />
  if (query.state === EQueryState.Failed) {
    return (
      <SidebarGroup>
        <LoadFailed label="threads" message={query.error.message} onRetry={query.reload} />
      </SidebarGroup>
    )
  }
  return (
    <ThreadActionsContext.Provider value={actions}>
      <ThreadList entries={entries ?? query.data} activeThreadId={activeThreadId} />
    </ThreadActionsContext.Provider>
  )
}
