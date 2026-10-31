'use client'

import type { WireEvent } from '@dltech/atlas-wire/web'
import { QueryObserver } from '@tanstack/react-query'

import { sharedQueryClient } from '@/lib/query-client'

import { fetchEvents } from './threads-api'

export const TRANSCRIPT_KEY_PREFIX = 'transcript-events'

export const transcriptEventsKey = (threadId: string): readonly string[] => [
  TRANSCRIPT_KEY_PREFIX,
  threadId,
]

export type TranscriptHistory = ReturnType<typeof createTranscriptHistory>

export function createTranscriptHistory(args: {
  threadId: string
  fetchSeed?: (threadId: string) => Promise<WireEvent[]>
}) {
  const client = sharedQueryClient()
  const queryKey = [...transcriptEventsKey(args.threadId), crypto.randomUUID()]
  const options = {
    queryKey,
    queryFn: () => args.fetchSeed?.(args.threadId) ?? fetchEvents({ threadId: args.threadId }),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  }
  const readSeed = () => client.fetchQuery(options)
  const retain = () =>
    new QueryObserver(client, { ...options, enabled: false }).subscribe(() => undefined)
  const snapshot = () => client.getQueryData<WireEvent[]>(queryKey)
  const replace = (events: WireEvent[]) => client.setQueryData(queryKey, events)
  return { readSeed, snapshot, replace, retain }
}
