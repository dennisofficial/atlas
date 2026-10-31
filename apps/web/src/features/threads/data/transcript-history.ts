'use client'

import type { WireEvent } from '@dltech/atlas-wire/web'

import { sharedQueryClient } from '@/lib/query-client'

import { fetchEvents, fetchThread } from './threads-api'

export const TRANSCRIPT_KEY_PREFIX = 'transcript-events'

export const transcriptEventsKey = (threadId: string): readonly string[] => [
  TRANSCRIPT_KEY_PREFIX,
  threadId,
]

const bootEpoch: string | null =
  typeof window === 'undefined' ? null : `boot:${window.location.pathname}`

export function fetchTranscriptEvents(threadId: string): Promise<WireEvent[]> {
  return sharedQueryClient().fetchQuery({
    queryKey: [...transcriptEventsKey(threadId), bootEpoch],
    queryFn: () => fetchEvents({ threadId }),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  })
}

export function fetchStoredThread(threadId: string) {
  return sharedQueryClient().fetchQuery({
    queryKey: [`thread:${threadId}`],
    queryFn: () => fetchThread(threadId),
    staleTime: 15_000,
    gcTime: 5 * 60_000,
  })
}
