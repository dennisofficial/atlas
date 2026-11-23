import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { toThreadId } from '@dltech/atlas-core'
import {
  ESessionConnection,
  isSessionWorking,
  memorySessionLog,
  overlayRewrote,
  transcriptEventsOf,
  type FollowedSession,
  type OverlaySignalSource,
} from '@dltech/atlas-client/stream'
import type { InFlightStep, TranscriptModel } from '@dltech/atlas-client/transcript'

import { createConversationStore } from '../store/conversation-store'
import type { TurnClock } from '../ui/turn-clock'
import { overlaySignalFeed } from './overlay-signal-feed'
import { v2EventTypes } from './registered-plugins'
import type { SessionClient } from './session-client'

const NOT_CONNECTED = ESessionConnection.Reconnecting

export type SessionTranscript = {
  model: TranscriptModel
  turn: TurnClock
  liveSteps: readonly InFlightStep[]
  connection: ESessionConnection
  name: string | null
  sessionId: string
  loadOlder: () => Promise<number>
}

export function useSessionTranscript(args: {
  client: SessionClient
  sessionId: string
  title: string | null
  now: () => number
}): SessionTranscript {
  const { client, sessionId, title, now } = args
  const feed = useMemo(() => overlaySignalFeed(), [sessionId])
  const store = useMemo(
    () =>
      createConversationStore({
        signals: feed.signals,
        threadId: toThreadId(sessionId),
        paceReveal: true,
        readClock: now,
        name: title,
        effects: () => undefined,
      }),
    [feed, sessionId, title, now],
  )

  useEffect(() => () => store.dispose(), [store])

  const followed = useRef<FollowedSession | undefined>(undefined)
  const [connection, setConnection] = useState<ESessionConnection>(NOT_CONNECTED)

  useEffect(() => {
    const handle = client.connection.follow({ sessionId, log: memorySessionLog() })
    followed.current = handle
    const previous: { current: OverlaySignalSource | undefined } = { current: undefined }

    const push = () => {
      const snapshot = handle.getSnapshot()
      const next: OverlaySignalSource = {
        overlay: snapshot.overlay,
        working: isSessionWorking(snapshot.status),
      }
      if (overlayRewrote({ previous: previous.current, next })) store.resetSteps()
      previous.current = next
      feed.publish(next)
      store.setEvents({ events: transcriptEventsOf(snapshot.events, v2EventTypes) })
      setConnection(snapshot.connection)
    }

    const unsubscribe = handle.subscribe(push)
    push()

    return () => {
      followed.current = undefined
      unsubscribe()
      handle.close()
    }
  }, [client, feed, sessionId, store])

  const model = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const turn = useSyncExternalStore(store.subscribe, store.getTurn)
  const loadOlder = useCallback(() => followed.current?.loadOlder() ?? Promise.resolve(0), [])

  return {
    model,
    turn,
    liveSteps: store.liveSteps(),
    connection,
    name: title,
    sessionId,
    loadOlder,
  }
}
