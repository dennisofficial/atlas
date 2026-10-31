'use client'

import type { WireEvent } from '@dltech/atlas-wire/web'
import { QueryObserver } from '@tanstack/react-query'

import { sharedQueryClient } from '@/lib/query-client'

import {
  eventsSnapshot,
  type EventsCheckpoint,
  type EventsSnapshot,
  type SnapshotFetcher,
} from './events-snapshot'
import { fetchEvents } from './threads-api'

export const TRANSCRIPT_KEY_PREFIX = 'transcript-events'
export const transcriptEventsKey = (threadId: string): readonly string[] => [
  TRANSCRIPT_KEY_PREFIX,
  threadId,
]
export type TranscriptHistory = ReturnType<typeof createTranscriptHistory>

export function createTranscriptHistory(args: {
  threadId: string
  fetchSeed?: ((threadId: string) => Promise<WireEvent[]>) | undefined
  fetchSnapshot?: SnapshotFetcher | undefined
}) {
  const client = sharedQueryClient()
  const queryKey = [...transcriptEventsKey(args.threadId), crypto.randomUUID()]
  let version = 0
  let wantedRev: number | undefined
  const epochListeners = new Set<() => void>()
  const descriptor = () => client.getQueryData<EventsSnapshot>(queryKey)
  let pending: Promise<EventsSnapshot> | undefined
  const fetchFresh = async (): Promise<EventsSnapshot> => {
    const mine = version
    for (;;) {
      const value = args.fetchSnapshot
        ? await args.fetchSnapshot({ threadId: args.threadId })
        : eventsSnapshot(
            await (args.fetchSeed?.(args.threadId) ?? fetchEvents({ threadId: args.threadId })),
          )
      const current = descriptor()
      if (
        mine !== version &&
        current !== undefined &&
        (wantedRev === undefined || current.historyRev === wantedRev)
      )
        return current
      if (
        args.fetchSnapshot &&
        wantedRev !== undefined &&
        (value.historyRev === undefined || value.historyRev < wantedRev)
      )
        continue
      return value
    }
  }
  const refreshSnapshot = () => {
    if (pending !== undefined) return pending
    pending = fetchFresh().finally(() => {
      pending = undefined
    })
    return pending
  }
  const options = {
    queryKey,
    queryFn: async (): Promise<EventsSnapshot> => {
      const mine = version
      const value = await refreshSnapshot()
      const current = descriptor()
      return mine !== version &&
        current !== undefined &&
        (wantedRev === undefined || current.historyRev === wantedRev)
        ? current
        : value
    },
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  }
  const readSnapshot = async (): Promise<EventsSnapshot> => {
    const current = descriptor()
    if (
      args.fetchSnapshot &&
      wantedRev !== undefined &&
      current !== undefined &&
      (current.historyRev === undefined || current.historyRev < wantedRev)
    ) {
      const value = await refreshSnapshot()
      replaceSnapshot(value)
      return value
    }
    return client.fetchQuery(options)
  }
  const readSeed = async () => (await readSnapshot()).events
  const retain = () =>
    new QueryObserver(client, { ...options, enabled: false }).subscribe(() => undefined)
  const snapshot = () => descriptor()?.events
  const replaceSnapshot = (value: EventsSnapshot) => {
    if (wantedRev !== undefined && value.historyRev !== undefined && value.historyRev < wantedRev)
      return
    version += 1
    client.setQueryData(queryKey, value)
    expectEpoch(value)
  }
  const replace = (events: WireEvent[]) => {
    if (events === snapshot()) return
    const next = eventsSnapshot(events)
    const previous = descriptor()
    replaceSnapshot(
      previous?.historyRev !== undefined && next.head >= previous.head
        ? { ...next, historyRev: previous.historyRev }
        : next,
    )
  }
  const expectEpoch = (checkpoint: EventsCheckpoint) => {
    const rev = checkpoint.historyRev
    if (rev === undefined || (wantedRev !== undefined && rev <= wantedRev)) return
    const changed =
      (wantedRev !== undefined && wantedRev !== rev) ||
      (descriptor()?.historyRev !== undefined && descriptor()?.historyRev !== rev)
    wantedRev = rev
    if (changed) for (const listener of [...epochListeners]) listener()
  }
  const onEpochChange = (listener: () => void) => {
    epochListeners.add(listener)
    return () => {
      epochListeners.delete(listener)
    }
  }
  const backendSnapshot = args.fetchSnapshot
  const fetchSnapshot: SnapshotFetcher | undefined =
    backendSnapshot === undefined
      ? undefined
      : (request) => (request.fromSeq === undefined ? refreshSnapshot() : backendSnapshot(request))
  return {
    readSeed,
    readSnapshot,
    refreshSnapshot,
    fetchSnapshot,
    snapshot,
    descriptor,
    replace,
    replaceSnapshot,
    retain,
    expectEpoch,
    onEpochChange,
  }
}
