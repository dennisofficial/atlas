import { useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'

import { SidebarGroup } from '@dltech/atlas-ui/components/sidebar'

import { V2_SESSIONS_KEY } from '@/lib/cloud-keys'
import { useInvalidateCloud } from '@/lib/use-invalidate-cloud'
import { LoadFailed } from '@/features/settings/data/shared/query-gate'
import { EQueryState, type CloudQuery } from '@/lib/use-cloud-query'

import type { SessionNode } from '@/features/threads/data/threads-api'

import { archiveThread } from './archive-thread'
import { ThreadsSkeleton } from './shell-skeletons'
import { ThreadList } from './shell-thread-list'
import { ThreadActionsContext } from './thread-actions-context'
import type { ProjectThreads } from './thread-partition'
import { useThreadArchive } from './use-thread-archive'
import { v2SessionHref, v2SessionIdsOf } from './v2-rows'

export function ShellSidebarContent({
  query,
  activeThreadId,
}: {
  query: CloudQuery<ProjectThreads[]>
  activeThreadId: string | null
}) {
  const router = useRouter()
  const invalidateCloud = useInvalidateCloud()
  const v2Ids = useMemo(() => v2SessionIdsOf(query.data), [query.data])
  const handleArchived = useCallback(
    (threadId: string) => {
      if (threadId !== activeThreadId) return
      router.replace('/threads')
      const href = v2Ids.has(threadId)
        ? v2SessionHref(threadId)
        : `/threads/${encodeURIComponent(threadId)}`
      return () => router.push(href)
    },
    [activeThreadId, router, v2Ids],
  )
  const archive = useCallback(
    async (args: Parameters<typeof archiveThread>[0]) => {
      const v2 = v2Ids.has(args.threadId)
      await archiveThread({ ...args, v2 })
      if (v2) await invalidateCloud([V2_SESSIONS_KEY])
    },
    [v2Ids, invalidateCloud],
  )
  const teammateIds = useMemo(() => {
    const ids = new Set<string>()
    const visit = (sessions: readonly SessionNode[]) => {
      for (const session of sessions) {
        ids.add(session.mainThread.id)
        visit(session.teammates)
      }
    }
    for (const entry of query.data ?? []) {
      for (const session of entry.sessions) visit(session.teammates)
    }
    return ids
  }, [query.data])
  const isTeammate = useCallback((threadId: string) => teammateIds.has(threadId), [teammateIds])
  const { entries, handleToggleArchive } = useThreadArchive({
    entries: query.data,
    reload: query.reload,
    onArchived: handleArchived,
    isTeammate,
    archive,
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
