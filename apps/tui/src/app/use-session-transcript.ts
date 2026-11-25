import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import type { Event, PendingInputsState, RecordEvent } from '@dltech/atlas-core'
import { EMPTY_PENDING, toThreadId } from '@dltech/atlas-core'
import type { SessionStatusOutput, SessionViewOutput } from '@dltech/atlas-protocol'
import {
  ESessionConnection,
  isSessionWorking,
  isTurnRunning,
  memorySessionLog,
  overlayRewrote,
  transcriptEventsOf,
  type FollowedSession,
  type OverlaySignalSource,
  type SessionSnapshot,
} from '@dltech/atlas-client/stream'
import type { QuickStopEvidence } from '@dltech/atlas-client/session'
import type { InFlightStep, TranscriptModel } from '@dltech/atlas-client/transcript'

import { createConversationStore } from '../store/conversation-store'
import type { TurnClock } from '../ui/turn-clock'
import { overlaySignalFeed } from './overlay-signal-feed'
import { eventTypes } from './registered-plugins'
import type { SessionClient } from './session-client'

const NOT_CONNECTED = ESessionConnection.Reconnecting

const NO_EVENTS: readonly Event[] = Object.freeze([])

const NO_FOLDABLE: readonly RecordEvent[] = Object.freeze([])

type SessionLive = {
  sessionId: string
  foldable: readonly RecordEvent[]
  pending: PendingInputsState
  loaded: boolean
}

type ShellTails = SessionSnapshot['shells']

export type SessionTranscript = {
  model: TranscriptModel
  turn: TurnClock
  liveSteps: readonly InFlightStep[]
  connection: ESessionConnection
  name: string | null
  sessionId: string
  loadOlder: () => Promise<number>
  events: readonly Event[]
  rawEvents: readonly RecordEvent[]
  foldable: readonly RecordEvent[]
  loaded: boolean
  quickStops: readonly QuickStopEvidence[]
  status: SessionStatusOutput | undefined
  pending: PendingInputsState
  working: boolean
  view: SessionViewOutput | undefined
  shells: ShellTails
}

export function useSessionTranscript(args: {
  client: SessionClient
  sessionId: string
  threadId?: string | undefined
  title: string | null
  now: () => number
}): SessionTranscript {
  const { client, sessionId, threadId, title, now } = args
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
  const [rawEvents, setRawEvents] = useState<readonly RecordEvent[]>([])
  const [quickStops, setQuickStops] = useState<readonly QuickStopEvidence[]>([])
  const [status, setStatus] = useState<SessionStatusOutput | undefined>(undefined)
  const [live, setLive] = useState<SessionLive>({
    sessionId,
    foldable: NO_FOLDABLE,
    pending: EMPTY_PENDING,
    loaded: false,
  })
  const [working, setWorking] = useState(false)
  const [panes, setPanes] = useState<{ view: SessionViewOutput | undefined; shells: ShellTails }>({
    view: undefined,
    shells: {},
  })

  const mapped = useRef<{ source: readonly RecordEvent[]; events: Event[] } | null>(null)

  useEffect(() => {
    const handle = client.connection.follow({
      sessionId,
      ...(threadId === undefined ? {} : { threadId }),
      log: memorySessionLog(),
    })
    followed.current = handle
    const previous: { current: OverlaySignalSource | undefined } = { current: undefined }

    const push = () => {
      const snapshot = handle.getSnapshot()
      const next: OverlaySignalSource = {
        overlay: snapshot.overlay,
        working: isTurnRunning(snapshot.status),
      }
      if (overlayRewrote({ previous: previous.current, next })) store.resetSteps()
      previous.current = next
      feed.publish(next)
      if (mapped.current?.source !== snapshot.events) {
        mapped.current = {
          source: snapshot.events,
          events: transcriptEventsOf(snapshot.events, eventTypes),
        }
      }
      store.setEvents({ events: mapped.current.events })
      setConnection(snapshot.connection)
      setRawEvents(snapshot.events)
      setQuickStops(snapshot.quickStops)
      setStatus(snapshot.status)
      setLive((current) => {
        const loaded = snapshot.cursor !== undefined || snapshot.status !== undefined
        if (
          current.sessionId === sessionId &&
          current.foldable === snapshot.foldable &&
          current.pending === snapshot.pending &&
          current.loaded === loaded
        ) {
          return current
        }
        return { sessionId, foldable: snapshot.foldable, pending: snapshot.pending, loaded }
      })
      setWorking(isSessionWorking(snapshot.status))
      setPanes((current) =>
        current.view === snapshot.view && current.shells === snapshot.shells
          ? current
          : { view: snapshot.view, shells: snapshot.shells },
      )
    }

    const unsubscribe = handle.subscribe(push)
    push()

    return () => {
      followed.current = undefined
      unsubscribe()
      handle.close()
    }
  }, [client, feed, sessionId, store, threadId])

  const model = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const turn = useSyncExternalStore(store.subscribe, store.getTurn)
  const loadOlder = useCallback(() => followed.current?.loadOlder() ?? Promise.resolve(0), [])

  const events = mapped.current?.events ?? NO_EVENTS

  return {
    model,
    turn,
    liveSteps: store.liveSteps(),
    connection,
    name: title,
    sessionId,
    loadOlder,
    events,
    rawEvents,
    foldable: live.sessionId === sessionId ? live.foldable : NO_FOLDABLE,
    quickStops,
    status,
    pending: live.sessionId === sessionId ? live.pending : EMPTY_PENDING,
    loaded: live.sessionId === sessionId ? live.loaded : false,
    working,
    view: panes.view,
    shells: panes.shells,
  }
}
