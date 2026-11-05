import { ESessionStatus, type V2Event } from '@dltech/atlas-core'
import type { SessionStatusOutput, StreamServerMessage } from '@dltech/atlas-protocol'

import { EStreamConnectionState } from './connection-machine'
import {
  applyOverlayMessage,
  closeOverlayForEvents,
  EMPTY_OVERLAY_STATE,
  type OpenOverlay,
  type OverlayState,
} from './overlay-store'
import type { SessionCache } from './session-cache'
import {
  applyPage,
  EMPTY_WINDOW,
  resetWindow,
  type SessionCursor,
  type SessionWindow,
} from './session-window'
import type { StreamScheduler } from './stream-ports'

const SAVE_INTERVAL_MS = 1_000

export enum ESessionConnection {
  Live = 'live',
  CatchingUp = 'catching-up',
  Reconnecting = 'reconnecting',
  Offline = 'offline',
}

export type SessionSnapshot = {
  events: readonly V2Event[]
  cursor: SessionCursor | undefined
  status: SessionStatusOutput | undefined
  overlay: OpenOverlay | undefined
  connection: ESessionConnection
}

export type SessionFollower = {
  getSnapshot(): SessionSnapshot
  subscribe(listener: () => void): () => void
  handleMessage(message: StreamServerMessage): void
  setConnection(phase: EStreamConnectionState): void
  markResubscribing(): void
  cursor(): SessionCursor | undefined
  hydrated: Promise<void>
}

export type SessionFollowerArgs = {
  sessionId: string
  cache: SessionCache
  scheduler: StreamScheduler
  onResnap(): void
}

type Inner = {
  window: SessionWindow
  overlay: OverlayState
  status: SessionStatusOutput | undefined
  phase: EStreamConnectionState
  live: boolean
}

const connectionOf = (inner: Pick<Inner, 'phase' | 'live'>): ESessionConnection => {
  if (inner.phase === EStreamConnectionState.Closed) return ESessionConnection.Offline
  if (inner.phase !== EStreamConnectionState.Open) return ESessionConnection.Reconnecting
  return inner.live ? ESessionConnection.Live : ESessionConnection.CatchingUp
}

const snapshotOf = (inner: Inner): SessionSnapshot => ({
  events: inner.window.events,
  cursor: inner.window.cursor,
  status: inner.status,
  overlay: inner.overlay.open,
  connection: connectionOf(inner),
})

const acceptsView = (args: { inner: Inner; at: number }): boolean =>
  args.at >= (args.inner.window.cursor?.seq ?? 0)

export const createSessionFollower = (args: SessionFollowerArgs): SessionFollower => {
  const { sessionId, cache, scheduler } = args
  let inner: Inner = {
    window: EMPTY_WINDOW,
    overlay: EMPTY_OVERLAY_STATE,
    status: undefined,
    phase: EStreamConnectionState.Connecting,
    live: false,
  }
  let snapshot = snapshotOf(inner)
  const listeners = new Set<() => void>()
  let lastSavedAt: number | undefined
  let saveTimer: unknown

  const commit = (next: Inner): void => {
    inner = next
    snapshot = snapshotOf(inner)
    for (const listener of [...listeners]) listener()
  }

  const save = (): void => {
    saveTimer = undefined
    lastSavedAt = scheduler.now()
    void cache.save({ sessionId, window: inner.window }).catch(() => undefined)
  }

  const saveThrottled = (): void => {
    if (saveTimer !== undefined) return
    const wait = lastSavedAt === undefined ? 0 : lastSavedAt + SAVE_INTERVAL_MS - scheduler.now()
    if (wait <= 0) {
      save()
      return
    }
    saveTimer = scheduler.setTimeout(save, wait)
  }

  const handleEvents = (message: Extract<StreamServerMessage, { type: 'events' }>): void => {
    const window = applyPage({
      window: inner.window,
      page: { events: message.events, head: message.head },
    })
    const overlay = closeOverlayForEvents({ state: inner.overlay, events: window.events })
    commit({ ...inner, window, overlay, live: message.live })
    saveThrottled()
  }

  const handleView = (message: Extract<StreamServerMessage, { type: 'view' }>): void => {
    if (!acceptsView({ inner, at: message.at })) return
    commit({ ...inner, status: message.value })
  }

  const handleOverlayMessage = (
    message: Extract<
      StreamServerMessage,
      { type: 'overlay' | 'delta' | 'overlay-clear' | 'frame' }
    >,
  ): void => {
    const applied = applyOverlayMessage({ state: inner.overlay, message })
    const overlay =
      message.type === 'overlay'
        ? closeOverlayForEvents({ state: applied.state, events: inner.window.events })
        : applied.state
    if (overlay === inner.overlay) return
    commit({ ...inner, overlay })
    if (applied.needsResnap) args.onResnap()
  }

  const handleMessage = (message: StreamServerMessage): void => {
    if (message.type === 'events') handleEvents(message)
    else if (message.type === 'view') handleView(message)
    else if (message.type === 'reset') {
      commit({ ...inner, window: resetWindow(), status: undefined, live: false })
    } else if (
      message.type === 'overlay' ||
      message.type === 'delta' ||
      message.type === 'overlay-clear' ||
      message.type === 'frame'
    ) {
      handleOverlayMessage(message)
    }
  }

  const hydrated = cache
    .load(sessionId)
    .then((window) => {
      if (window === undefined || inner.window.cursor !== undefined) return
      commit({ ...inner, window })
    })
    .catch(() => undefined)

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    handleMessage,
    setConnection: (phase) => {
      if (phase === inner.phase) return
      commit({ ...inner, phase, live: false })
    },
    markResubscribing: () => {
      commit({ ...inner, live: false, overlay: { ...inner.overlay, open: undefined } })
    },
    cursor: () => inner.window.cursor,
    hydrated,
  }
}
