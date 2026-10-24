import { SidebarGroup } from '@dltech/atlas-ui/components/sidebar'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

import { LoadFailed } from '@/features/settings/data/workspace/query-gate'
import { EQueryState, type CloudQuery } from '@/lib/use-cloud-query'

import { ThreadList } from './shell-thread-list'
import type { ProjectThreads } from './thread-partition'

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
  if (query.state === EQueryState.Loading) return <ThreadsSkeleton />
  if (query.state === EQueryState.Failed) {
    return (
      <SidebarGroup>
        <LoadFailed label="threads" message={query.error.message} onRetry={query.reload} />
      </SidebarGroup>
    )
  }
  return <ThreadList entries={query.data} activeThreadId={activeThreadId} />
}
