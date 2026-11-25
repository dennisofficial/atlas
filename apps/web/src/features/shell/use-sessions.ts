'use client'

import { createSessionsFeed, gcSessionLog, type SessionsFeed } from '@dltech/atlas-client/stream'
import type { SessionSummary } from '@dltech/atlas-protocol'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect } from 'react'

import { fetchSessions } from '@/features/sessions/data/sessions-api'
import { sessionLog, sessionStream } from '@/features/sessions/data/session-stream'
import { track } from '@/lib/analytics/analytics'
import { sidebarSnapshotProps } from '@/lib/analytics/perf'
import { SESSIONS_KEY } from '@/lib/cloud-keys'

import { readSessionsCache, writeSessionsCache } from './sidebar-cache'

const NONE: readonly SessionSummary[] = []

const feeds = new WeakMap<QueryClient, SessionsFeed>()

const feedOf = (queryClient: QueryClient): SessionsFeed => {
  const existing = feeds.get(queryClient)
  if (existing !== undefined) return existing
  const mountedAt = performance.now()
  let snapshotReported = false
  const feed = createSessionsFeed({
    follow: () => sessionStream().followSessions(),
    write: (rows) => {
      queryClient.setQueryData([SESSIONS_KEY], rows)
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

export function useSessions(): readonly SessionSummary[] {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: [SESSIONS_KEY],
    queryFn: fetchSessions,
    staleTime: Infinity,
  })
  useLayoutEffect(() => {
    if (queryClient.getQueryData([SESSIONS_KEY]) !== undefined) return
    const cached = readSessionsCache()
    if (cached === undefined) return
    queryClient.setQueryData([SESSIONS_KEY], cached)
    void queryClient.invalidateQueries({ queryKey: [SESSIONS_KEY], refetchType: 'none' })
  }, [queryClient])
  useEffect(() => feedOf(queryClient).retain(), [queryClient])
  const rows = query.data
  useEffect(() => {
    if (rows === undefined) return
    writeSessionsCache(rows)
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
