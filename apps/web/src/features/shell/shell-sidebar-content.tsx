import { useMemo } from 'react'

import { SidebarGroup } from '@dltech/atlas-ui/components/sidebar'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

import { LoadFailed } from '@/features/settings/data/workspace/query-gate'
import { EQueryState, type CloudQuery } from '@/lib/use-cloud-query'

import { ThreadList } from './shell-thread-list'
import { ThreadActionsContext } from './thread-actions-context'
import type { ProjectThreads } from './thread-partition'
import { useThreadArchive } from './use-thread-archive'

const SKELETON_ROWS = ['one', 'two', 'three', 'four', 'five']

function ThreadsSkeleton() {
  return (
    <SidebarGroup role="status" aria-label="Loading threads" className="gap-2 px-2 py-2">
      {SKELETON_ROWS.map((row) => (
        <Skeleton key={row} className="h-7 w-full" />
      ))}
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
  const { entries, handleToggleArchive } = useThreadArchive({
    entries: query.data,
    reload: query.reload,
  })
  const actions = useMemo(() => ({ onToggleArchive: handleToggleArchive }), [handleToggleArchive])

  if (query.state === EQueryState.Loading) return <ThreadsSkeleton />
  if (query.state === EQueryState.Failed) {
    return (
      <SidebarGroup className="px-2 py-2">
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
