'use client'

import { createSessionsFeed, gcSessionLog, type SessionsFeed } from '@dltech/atlas-client/stream'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect } from 'react'

import { fetchV2Sessions } from '@/features/sessions/data/sessions-api'
import { sessionLog, sessionStream } from '@/features/sessions/data/session-stream'
import { track } from '@/lib/analytics/analytics'
import { sidebarSnapshotProps } from '@/lib/analytics/perf'
import { V2_SESSIONS_KEY } from '@/lib/cloud-keys'

import { readV2SessionsCache, writeV2SessionsCache } from './sidebar-cache'
import type { V2SessionSummary } from './v2-rows'

const NONE: readonly V2SessionSummary[] = []

const feeds = new WeakMap<QueryClient, SessionsFeed>()

const feedOf = (queryClient: QueryClient): SessionsFeed => {
  const existing = feeds.get(queryClient)
  if (existing !== undefined) return existing
  const mountedAt = performance.now()
  let snapshotReported = false
  const feed = createSessionsFeed({
    follow: () => sessionStream().followSessions(),
    write: (rows) => {
      queryClient.setQueryData([V2_SESSIONS_KEY], rows)
      if (snapshotReported) return
      snapshotReported = true
      track(
        'sidebar_stream_snapshot',
        sidebarSnapshotProps({ rows: rows.length, mountedAt, now: performance.now() }),
      )
    },
  })
  feeds.set(queryClient, feed)
  return feed
}

export function useV2Sessions(): readonly V2SessionSummary[] {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: [V2_SESSIONS_KEY],
    queryFn: fetchV2Sessions,
    staleTime: Infinity,
  })
  useLayoutEffect(() => {
    if (queryClient.getQueryData([V2_SESSIONS_KEY]) !== undefined) return
    const cached = readV2SessionsCache()
    if (cached === undefined) return
    queryClient.setQueryData([V2_SESSIONS_KEY], cached)
    void queryClient.invalidateQueries({ queryKey: [V2_SESSIONS_KEY], refetchType: 'none' })
  }, [queryClient])
  useEffect(() => feedOf(queryClient).retain(), [queryClient])
  const rows = query.data
  useEffect(() => {
    if (rows === undefined) return
    writeV2SessionsCache(rows)
    void gcSessionLog({
      log: sessionLog(),
      sessions: rows.map((row) => ({
        sessionId: row.sessionId,
        archived: row.archivedAt !== null && row.archivedAt !== undefined,
      })),
    })
  }, [rows])
  return rows ?? NONE
}
