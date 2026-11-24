import type { PluginViewFold, V2Event } from '@dltech/atlas-core'
import type { StreamServerMessage } from '@dltech/atlas-protocol'
import type { z } from 'zod'

import {
  EConnectionTimer,
  EStreamConnectionState,
  initialConnectionState,
  reduceConnection,
  type ConnectionEffect,
  type ConnectionInput,
  type ConnectionState,
} from './connection-machine'
import { createListRetry, type ListRetry } from './list-retry'
import { memorySessionLog } from './session-log'
import { createSessionFollower, type SessionFollower } from './session-follower'
import { fetchOlderOf } from './session-older'
import {
  createSessionsList,
  sessionsListFrameHandler,
  type FollowedSessionList,
  type SessionsList,
} from './sessions-list'
import { createStreamHandlers } from './stream-handlers'
import { followInputOf, followWithTailFallback } from './stream-follow'
import {
  browserNetworkSignal,
  type FollowArgs,
  type StreamNetworkSignal,
  type StreamScheduler,
  type StreamSubscription,
  type StreamTransport,
} from './stream-ports'

export type StreamConnectionArgs = {
  transport: StreamTransport
  scheduler: StreamScheduler
  networkSignal?: StreamNetworkSignal | undefined
  eventSchema?: z.ZodType<V2Event> | undefined
  knownEventTypes?: ReadonlySet<string> | undefined
  views?: readonly PluginViewFold[] | undefined
}

export type FollowedSession = SessionFollower & { close(): void }

export type StreamConnection = {
  follow(args: FollowArgs): FollowedSession
  followSessions(): FollowedSessionList
  connect(): void
  reconnect(): void
  close(): void
  state(): EStreamConnectionState
}

type Held = { subscription: StreamSubscription | undefined; epoch: number; watchdog: unknown }

type Followed = Held & {
  id: string
  sessionId: string
  threadId: string | undefined
  follower: SessionFollower
}

type Listed = Held & { list: SessionsList; retry: ListRetry; stop(): void }

export const createStreamConnection = (args: StreamConnectionArgs): StreamConnection => {
  const { scheduler } = args
  let machine: ConnectionState = initialConnectionState()
  let generation = 0
  let nextId = 0
  let tailUnsupported = false
  let unsubscribeNetwork: (() => void) | undefined
  const timers = new Map<EConnectionTimer, unknown>()
  const followed = new Map<string, Followed>()
  const lists = new Set<Listed>()

  const stopSubscription = (holder: Followed | Listed): void => {
    if ('retry' in holder) holder.retry.cancel()
    holder.epoch += 1
    clearWatchdog(holder)
    holder.subscription?.close()
    holder.subscription = undefined
  }

  function clearWatchdog(holder: { watchdog: unknown }): void {
    if (holder.watchdog === undefined) return
    scheduler.clearTimeout(holder.watchdog)
    holder.watchdog = undefined
  }

  function dispatch(input: ConnectionInput): void {
    const before = machine.phase
    const step = reduceConnection({ state: machine, input, random: scheduler.random() })
    machine = step.state
    if (machine.phase !== before) {
      for (const entry of followed.values()) entry.follower.setConnection(machine.phase)
      watchNetwork(machine.phase)
    }
    for (const effect of step.effects) run(effect)
  }

  const subscribeFollow = (entry: Followed): void => {
    stopSubscription(entry)
    let opened = false
    const handlers = handlersOf(entry, (frame) => entry.follower.handleMessage(frame))
    entry.subscription = followWithTailFallback({
      transport: args.transport,
      input: followInputOf({
        sessionId: entry.sessionId,
        threadId: entry.threadId,
        cursor: entry.follower.cursor(),
      }),
      handlers: {
        ...handlers,
        handleFrame: (frame) => {
          opened = true
          handlers.handleFrame(frame)
        },
      },
      tailUnsupported,
      sawFrame: () => opened,
      onUnsupportedTail: () => resnap(entry, { tailUnsupported: true }),
    })
  }

  const live = (): boolean =>
    machine.phase === EStreamConnectionState.Connecting ||
    machine.phase === EStreamConnectionState.Open

  const subscribeWhenHydrated = (entry: Followed): void => {
    const born = generation
    void entry.follower.hydrated.then(() => {
      if (!live() || born !== generation || followed.get(entry.id) !== entry) return
      subscribeFollow(entry)
    })
  }

  const subscribeList = (entry: Listed): void => {
    stopSubscription(entry)
    entry.subscription = args.transport.list(handlersOf(entry, sessionsListFrameHandler(entry)))
  }

  const subscribeAll = (): void => {
    generation += 1
    for (const entry of followed.values()) subscribeWhenHydrated(entry)
    for (const entry of lists) subscribeList(entry)
  }

  const abortAll = (): void => {
    generation += 1
    for (const entry of followed.values()) stopSubscription(entry)
    for (const entry of lists) stopSubscription(entry)
  }

  const schedule = (request: { timer: EConnectionTimer; ms: number }): void => {
    cancel(request.timer)
    timers.set(
      request.timer,
      scheduler.setTimeout(() => {
        timers.delete(request.timer)
        dispatch({ type: 'timer-fired', timer: request.timer })
      }, request.ms),
    )
  }

  const cancel = (timer: EConnectionTimer): void => {
    if (!timers.has(timer)) return
    scheduler.clearTimeout(timers.get(timer))
    timers.delete(timer)
  }

  const run = (effect: ConnectionEffect): void => {
    if (effect.type === 'subscribe') subscribeAll()
    else if (effect.type === 'abort') abortAll()
    else if (effect.type === 'schedule') schedule(effect)
    else cancel(effect.timer)
  }

  const watchNetwork = (phase: EStreamConnectionState): void => {
    if (phase === EStreamConnectionState.Closed) {
      unsubscribeNetwork?.()
      unsubscribeNetwork = undefined
      return
    }
    unsubscribeNetwork ??= (args.networkSignal ?? browserNetworkSignal)(() =>
      dispatch({ type: 'network-online' }),
    )
  }

  const handlersOf = (holder: Followed | Listed, onFrame: (frame: StreamServerMessage) => void) =>
    createStreamHandlers({
      holder,
      scheduler,
      clearWatchdog,
      onStall: () => {
        stopSubscription(holder)
        dispatch({ type: 'failure', status: undefined })
      },
      onFrame: (frame) => {
        if (lifecycle(holder, frame)) return
        onFrame(frame)
      },
      onFailure: (status) => dispatch({ type: 'failure', status }),
      onEnd: () => dispatch({ type: 'ended' }),
    })

  const lifecycle = (entry: Followed | Listed, frame: StreamServerMessage): boolean => {
    if (frame.type === 'ready') {
      dispatch({ type: 'opened' })
      return true
    }
    if (frame.type === 'going-away') {
      dispatch({ type: 'going-away', reconnectAfterMs: frame.reconnectAfterMs })
      return true
    }
    return false
  }

  const resnap = (entry: Followed, extra: { tailUnsupported?: boolean } = {}): void => {
    if (extra.tailUnsupported === true) tailUnsupported = true
    entry.follower.markResubscribing()
    subscribeFollow(entry)
  }

  const ensureConnected = (): void => {
    if (machine.phase === EStreamConnectionState.Closed && machine.reason === undefined) {
      dispatch({ type: 'connect' })
    } else if (machine.phase === EStreamConnectionState.Backoff) {
      dispatch({ type: 'reconnect-requested' })
    }
  }

  const follow: StreamConnection['follow'] = ({ sessionId, threadId, log }) => {
    nextId += 1
    const id = `s${nextId}`
    const entry: Followed = {
      id,
      sessionId,
      threadId,
      follower: createSessionFollower({
        sessionId,
        log: log ?? memorySessionLog(),
        scheduler,
        onResnap: () => resnap(entry),
        onTailUnsupported: () => resnap(entry, { tailUnsupported: true }),
        ...fetchOlderOf({ transport: args.transport, threadId }),
        eventSchema: args.eventSchema,
        knownEventTypes: args.knownEventTypes,
        views: args.views,
      }),
      subscription: undefined,
      epoch: 0,
      watchdog: undefined,
    }
    ensureConnected()
    followed.set(id, entry)
    entry.follower.setConnection(machine.phase)
    if (live()) subscribeWhenHydrated(entry)
    return {
      ...entry.follower,
      close: () => {
        if (followed.get(id) !== entry) return
        followed.delete(id)
        stopSubscription(entry)
      },
    }
  }

  const followSessions: StreamConnection['followSessions'] = () => {
    const entry: Listed = {
      list: createSessionsList(),
      retry: createListRetry({ scheduler, live, resubscribe: () => subscribeList(entry) }),
      stop: () => stopSubscription(entry),
      subscription: undefined,
      epoch: 0,
      watchdog: undefined,
    }
    ensureConnected()
    lists.add(entry)
    if (live()) subscribeList(entry)
    return {
      ...entry.list.view,
      close: () => {
        lists.delete(entry)
        stopSubscription(entry)
      },
    }
  }

  return {
    follow,
    followSessions,
    connect: () => dispatch({ type: 'connect' }),
    reconnect: () => dispatch({ type: 'reconnect-requested' }),
    close: () => dispatch({ type: 'close-requested' }),
    state: () => machine.phase,
  }
}
