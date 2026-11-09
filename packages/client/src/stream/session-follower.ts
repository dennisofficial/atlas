import { EWorkspaceStep, EWorkspaceStepState, type V2Event } from '@dltech/atlas-core'
import type { z } from 'zod'
import {
  isSetupOutputCallId,
  type EStreamErrorCode,
  type SessionStatusOutput,
  type SessionViewOutput,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'

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
  applyPageOutcome,
  EMPTY_WINDOW,
  resetWindow,
  type SessionCursor,
  type SessionWindow,
} from './session-window'
import { defaultKnownEventTypes } from './known-event-types'
import type { StreamScheduler } from './stream-ports'

const SAVE_INTERVAL_MS = 1_000

const SETUP_OUTPUT_TAIL_CHARS = 16_000

export const HYDRATE_TIMEOUT_MS = 2_000

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
  view?: SessionViewOutput | undefined
  overlay: OpenOverlay | undefined
  setupOutput?: string | undefined
  connection: ESessionConnection
  error: EStreamErrorCode | undefined
  skipped: number
  writerAhead: boolean
  fromCache: boolean
}

export type SessionFollower = {
  getSnapshot(): SessionSnapshot
  subscribe(listener: () => void): () => void
  handleMessage(message: StreamServerMessage): void
  setConnection(phase: EStreamConnectionState): void
  setServerEventTypes(types: readonly string[] | undefined): void
  markResubscribing(): void
  cursor(): SessionCursor | undefined
  hydrated: Promise<void>
}

export type SessionFollowerArgs = {
  sessionId: string
  cache: SessionCache
  scheduler: StreamScheduler
  onResnap(): void
  eventSchema?: z.ZodType<V2Event> | undefined
  knownEventTypes?: ReadonlySet<string> | undefined
}

type Inner = {
  window: SessionWindow
  overlay: OverlayState
  status: SessionStatusOutput | undefined
  view: SessionViewOutput | undefined
  setupOutput: string
  phase: EStreamConnectionState
  live: boolean
  error: EStreamErrorCode | undefined
  skipped: number
  writerAhead: boolean
  fromCache: boolean
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
  view: inner.view,
  overlay: inner.overlay.open,
  setupOutput: inner.setupOutput,
  connection: connectionOf(inner),
  error: inner.error,
  skipped: inner.skipped,
  writerAhead: inner.writerAhead,
  fromCache: inner.fromCache,
})

const settlesSetup = (events: readonly Record<string, unknown>[]): boolean =>
  events.some(
    (event) =>
      event.type === 'workspace-step' &&
      event.step === EWorkspaceStep.Setup &&
      event.state !== EWorkspaceStepState.Started,
  )

const acceptsView = (args: { inner: Inner; at: number }): boolean =>
  args.at >= (args.inner.window.cursor?.seq ?? 0)

export const createSessionFollower = (args: SessionFollowerArgs): SessionFollower => {
  const { sessionId, cache, scheduler } = args
  const knownEventTypes = args.knownEventTypes ?? defaultKnownEventTypes
  let inner: Inner = {
    window: EMPTY_WINDOW,
    overlay: EMPTY_OVERLAY_STATE,
    status: undefined,
    view: undefined,
    setupOutput: '',
    phase: EStreamConnectionState.Connecting,
    live: false,
    error: undefined,
    skipped: 0,
    writerAhead: false,
    fromCache: false,
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
    const { window, skipped, issue } = applyPageOutcome({
      window: inner.window,
      page: { events: message.events, head: message.head },
      eventSchema: args.eventSchema,
    })
    const overlay = closeOverlayForEvents({ state: inner.overlay, events: window.events })
    if (skipped > 0) {
      console.warn(
        `session ${sessionId}: skipped ${skipped} event(s) this client cannot read: ${issue ?? 'unreadable event'}`,
      )
    }
    commit({
      ...inner,
      window,
      overlay,
      setupOutput: settlesSetup(message.events) ? '' : inner.setupOutput,
      live: message.live,
      error: undefined,
      skipped: inner.skipped + skipped,
      fromCache: false,
    })
    saveThrottled()
  }

  const handleSetupOutput = (text: string): void => {
    commit({ ...inner, setupOutput: (inner.setupOutput + text).slice(-SETUP_OUTPUT_TAIL_CHARS) })
  }

  const handleView = (message: Extract<StreamServerMessage, { type: 'view' }>): void => {
    if (!acceptsView({ inner, at: message.at })) return
    if (message.name === 'session') {
      commit({ ...inner, status: message.value.status, view: message.value })
      return
    }
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
    else if (message.type === 'error') commit({ ...inner, error: message.code })
    else if (message.type === 'reset') {
      commit({
        ...inner,
        window: resetWindow(),
        status: undefined,
        view: undefined,
        setupOutput: '',
        live: false,
        skipped: 0,
        fromCache: false,
      })
    } else if (
      message.type === 'frame' &&
      message.frame.type === 'tool-output' &&
      isSetupOutputCallId(message.frame.callId)
    ) {
      handleSetupOutput(message.frame.text)
    } else if (
      message.type === 'overlay' ||
      message.type === 'delta' ||
      message.type === 'overlay-clear' ||
      message.type === 'frame'
    ) {
      handleOverlayMessage(message)
    }
  }

  const hydrated = new Promise<void>((resolve) => {
    let settled = false
    const settle = (): boolean => {
      if (settled) return false
      settled = true
      scheduler.clearTimeout(timer)
      resolve()
      return true
    }
    const timer = scheduler.setTimeout(settle, HYDRATE_TIMEOUT_MS)
    cache
      .load(sessionId)
      .then((window) => {
        if (!settle() || window === undefined || inner.window.cursor !== undefined) return
        commit({ ...inner, window, fromCache: window.cursor !== undefined })
      })
      .catch(() => void settle())
  })

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
    setServerEventTypes: (types) => {
      const writerAhead = types?.some((type) => !knownEventTypes.has(type)) ?? false
      if (writerAhead === inner.writerAhead) return
      commit({ ...inner, writerAhead })
    },
    markResubscribing: () => {
      commit({ ...inner, live: false, overlay: { ...inner.overlay, open: undefined } })
    },
    cursor: () => inner.window.cursor,
    hydrated,
  }
}
