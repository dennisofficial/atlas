'use client'

import { createSessionsFeed, type SessionsFeed } from '@dltech/atlas-client/stream'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { fetchV2Sessions } from '@/features/sessions/data/sessions-api'
import { sessionStream } from '@/features/sessions/data/session-stream'
import { V2_SESSIONS_KEY } from '@/lib/cloud-keys'

import type { V2SessionSummary } from './v2-rows'

const NONE: readonly V2SessionSummary[] = []

const feeds = new WeakMap<QueryClient, SessionsFeed>()

const feedOf = (queryClient: QueryClient): SessionsFeed => {
  const existing = feeds.get(queryClient)
  if (existing !== undefined) return existing
  const feed = createSessionsFeed({
    follow: () => sessionStream().followSessions(),
    write: (rows) => void queryClient.setQueryData([V2_SESSIONS_KEY], rows),
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
  useEffect(() => feedOf(queryClient).retain(), [queryClient])
  return query.data ?? NONE
}
