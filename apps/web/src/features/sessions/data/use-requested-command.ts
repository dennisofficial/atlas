'use client'

import {
  acceptedCommandOf,
  type BlockingCommand,
  failedCommandOf,
  type RequestedCommand,
  requestedCommandDone,
  requestedCommandOf,
  type SessionSnapshot,
  shownBlockingOf,
} from '@dltech/atlas-client/stream'
import { useCallback, useEffect, useMemo, useState } from 'react'

export type TrackCommand = (args: { name: string; request: () => Promise<number> }) => Promise<void>

export type RequestedCommandState = {
  blocking: BlockingCommand | undefined
  track: TrackCommand
}

export const useRequestedCommand = (
  snapshot: Pick<SessionSnapshot, 'status' | 'events'>,
): RequestedCommandState => {
  const { status, events } = snapshot
  const [requested, setRequested] = useState<RequestedCommand | undefined>(undefined)
  const done = requested !== undefined && requestedCommandDone({ requested, status, events })

  useEffect(() => {
    if (done) setRequested(undefined)
  }, [done])

  const track = useCallback<TrackCommand>(async ({ name, request }) => {
    const entry = requestedCommandOf({ name, now: Date.now() })
    setRequested(entry)
    try {
      const inboxId = await request()
      setRequested((current) => acceptedCommandOf({ current, requested: entry, inboxId }))
    } catch (failure) {
      setRequested((current) => failedCommandOf({ current, requested: entry }))
      throw failure
    }
  }, [])

  const blocking = useMemo(
    () => shownBlockingOf({ requested: done ? undefined : requested, status }),
    [done, requested, status],
  )
  return useMemo(() => ({ blocking, track }), [blocking, track])
}
