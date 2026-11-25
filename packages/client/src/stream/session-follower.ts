import { foldableOf, type PluginViewFold, type RecordEvent } from '@dltech/atlas-core'
import type { z } from 'zod'
import { isSetupOutputCallId, type StreamServerMessage } from '@dltech/atlas-protocol'

import { EStreamConnectionState } from './connection-machine'
import {
  EMPTY_FRAME_FACTS,
  frameFactsOf,
  derivedViewOf,
  retryDeadlineMsOf,
  type FrameFacts,
} from './derived-session-view'
import { hydrateFollower } from './follower-hydrate'
import { createOlderLoader } from './follower-older'
import { createFollowerRender } from './follower-render'
import { ESessionConnection, type FollowedState, type SessionSnapshot } from './follower-state'
import { acceptsView, adoptRewindable, settlesSetup, viewSettlesCatchUp } from './follower-views'
import { createFollowerLogWriter } from './follower-writer'
import { applyOverlayMessage, closeOverlayForEvents, EMPTY_OVERLAY_STATE } from './overlay-store'
import { basedStateOf, resetStateOf } from './session-base'
import type { SessionLog } from './session-log'
import { applyShellOutput, withoutEndedShells } from './shell-tails'
import { applyPageOutcome, EMPTY_WINDOW, RENDER_LIMIT, type SessionCursor } from './session-window'
import { defaultKnownEventTypes } from './known-event-types'
import type { OlderFetch } from './session-older'
import type { StreamScheduler } from './stream-ports'

export { HYDRATE_TIMEOUT_MS } from './follower-hydrate'

const SETUP_OUTPUT_TAIL_CHARS = 16_000

export { ESessionConnection, type SessionSnapshot }

export type SessionFollower = {
  getSnapshot(): SessionSnapshot
  subscribe(listener: () => void): () => void
  handleMessage(message: StreamServerMessage): void
  setConnection(phase: EStreamConnectionState): void
  setServerEventTypes(types: readonly string[] | undefined): void
  markResubscribing(): void
  loadOlder(): Promise<number>
  cursor(): SessionCursor | undefined
  hydrated: Promise<void>
}

export type SessionFollowerArgs = {
  sessionId: string
  log: SessionLog
  scheduler: StreamScheduler
  onResnap(): void
  eventSchema?: z.ZodType<RecordEvent> | undefined
  knownEventTypes?: ReadonlySet<string> | undefined
  renderLimit?: number | undefined
  views?: readonly PluginViewFold[] | undefined
  fetchOlder?: OlderFetch | undefined
  onTailUnsupported?: (() => void) | undefined
}

type Inner = FollowedState

export const createSessionFollower = (args: SessionFollowerArgs): SessionFollower => {
  const { sessionId, log, scheduler } = args
  const knownEventTypes = args.knownEventTypes ?? defaultKnownEventTypes
  const baseRenderLimit = args.renderLimit ?? RENDER_LIMIT
  let renderLimit = baseRenderLimit
  let inner: Inner = {
    window: EMPTY_WINDOW,
    overlay: EMPTY_OVERLAY_STATE,
    frame: EMPTY_FRAME_FACTS,
    derived: { status: undefined, view: undefined },
    setupOutput: '',
    shells: {},
    phase: EStreamConnectionState.Connecting,
    live: false,
    error: undefined,
    skipped: 0,
    writerAhead: false,
    fromCache: false,
  }
  const render = createFollowerRender({ scheduler, innerOf: () => inner })
  const writer = createFollowerLogWriter({
    log,
    sessionId,
    scheduler,
    windowOf: () => inner.window,
  })
  let retryTimer: unknown
  let logHasEvents = false

  const apply = (next: Inner): void => {
    inner = {
      ...next,
      derived: derivedViewOf({ window: next.window, frame: next.frame, now: scheduler.now() }),
    }
    scheduleRetryWake()
  }

  const settle = (next: Inner, flush: () => void): void => {
    apply(next)
    flush()
  }

  const commit = (next: Inner): void => settle(next, render.flush)

  const deferCommit = (next: Inner): void => settle(next, render.defer)

  const scheduleRetryWake = (): void => {
    if (retryTimer !== undefined) {
      scheduler.clearTimeout(retryTimer)
      retryTimer = undefined
    }
    const now = scheduler.now()
    const due = retryDeadlineMsOf(inner.window, now)
    if (due === undefined) return
    retryTimer = scheduler.setTimeout(() => {
      retryTimer = undefined
      commit({ ...inner })
    }, due - now)
  }

  const handleEvents = (message: Extract<StreamServerMessage, { type: 'events' }>): void => {
    const { window, fresh, skipped, issue } = applyPageOutcome({
      window: inner.window,
      page: { events: message.events, head: message.head },
      eventSchema: args.eventSchema,
      renderLimit,
      views: args.views,
    })
    if (fresh.length > 0) {
      logHasEvents = true
      writer.append({ events: fresh, head: message.head })
    }
    const overlay = closeOverlayForEvents({ state: inner.overlay, events: window.events })
    if (skipped > 0) {
      console.warn(
        `session ${sessionId}: skipped ${skipped} event(s) this client cannot read: ${issue ?? 'unreadable event'}`,
      )
    }
    const next: Inner = {
      ...inner,
      window,
      overlay,
      shells: withoutEndedShells({ shells: inner.shells, events: message.events }),
      setupOutput: settlesSetup(message.events) ? '' : inner.setupOutput,
      live: message.live,
      error: undefined,
      skipped: inner.skipped + skipped,
      fromCache: false,
    }
    if (message.live || inner.live) commit(next)
    else deferCommit(next)
    writer.saveThrottled()
  }

  const handleShellOutput = (
    frame: Extract<StreamServerMessage, { type: 'frame' }>['frame'] & { type: 'shell-output' },
  ): void => {
    const shells = applyShellOutput({ shells: inner.shells, frame })
    if (shells !== inner.shells) commit({ ...inner, shells })
  }

  const handleSetupOutput = (text: string): void => {
    commit({ ...inner, setupOutput: (inner.setupOutput + text).slice(-SETUP_OUTPUT_TAIL_CHARS) })
  }

  const handleView = (message: Extract<StreamServerMessage, { type: 'view' }>): void => {
    if (message.name !== 'session') return
    const frame: FrameFacts = frameFactsOf(message.value)
    if (!acceptsView({ inner, at: message.at })) {
      commit({ ...inner, frame })
      return
    }
    const window = adoptRewindable({
      window: inner.window,
      views: args.views ?? [],
      pluginViews: message.value.pluginViews,
    })
    const live = viewSettlesCatchUp({ inner, at: message.at }) || inner.live
    commit({ ...inner, window, frame, live })
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

  const handleReset = (): void => {
    renderLimit = baseRenderLimit
    writer.drop()
    logHasEvents = false
    commit(resetStateOf(inner))
  }

  const handleBase = (message: Extract<StreamServerMessage, { type: 'base' }>): void => {
    const next = basedStateOf({ inner, message, eventSchema: args.eventSchema })
    if (next === undefined) {
      console.warn(`session ${sessionId}: unreadable tail base, replaying the log`)
      handleReset()
      args.onTailUnsupported?.()
      return
    }
    if (logHasEvents) writer.drop()
    logHasEvents = false
    renderLimit = baseRenderLimit
    commit(next)
  }

  const handleMessage = (message: StreamServerMessage): void => {
    if (message.type === 'events') handleEvents(message)
    else if (message.type === 'view') handleView(message)
    else if (message.type === 'error') commit({ ...inner, error: message.code })
    else if (message.type === 'reset') handleReset()
    else if (message.type === 'base') handleBase(message)
    else if (
      message.type === 'frame' &&
      message.frame.type === 'tool-output' &&
      isSetupOutputCallId(message.frame.callId)
    ) {
      handleSetupOutput(message.frame.text)
    } else if (message.type === 'frame' && message.frame.type === 'shell-output') {
      handleShellOutput(message.frame)
    } else if (
      message.type === 'overlay' ||
      message.type === 'delta' ||
      message.type === 'overlay-clear' ||
      message.type === 'frame'
    ) {
      handleOverlayMessage(message)
    }
  }

  const loadOlder = createOlderLoader({
    log,
    sessionId,
    windowOf: () => inner.window,
    fetchOlder: args.fetchOlder,
    eventSchema: args.eventSchema,
    extend: (visible) => {
      renderLimit += visible.length
      const events = [...visible, ...inner.window.events].slice(-renderLimit)
      commit({
        ...inner,
        window: {
          ...inner.window,
          events,
          foldable: foldableOf({ visible: events, durable: inner.window.durable }),
        },
      })
    },
  })

  const hydrated = hydrateFollower({
    log,
    sessionId,
    renderLimit,
    views: args.views,
    scheduler,
    restore: (window) => {
      if (inner.window.cursor !== undefined) return
      commit({ ...inner, window, fromCache: window.cursor !== undefined })
    },
  })

  return {
    getSnapshot: render.getSnapshot,
    subscribe: render.subscribe,
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
    loadOlder,
    cursor: () => inner.window.cursor,
    hydrated,
  }
}
