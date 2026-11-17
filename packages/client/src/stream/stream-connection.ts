import type { V2Event } from '@dltech/atlas-core'
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
import { memorySessionCache, type SessionCache } from './session-cache'
import { createSessionFollower, type SessionFollower } from './session-follower'
import { createSessionsList, type FollowedSessionList, type SessionsList } from './sessions-list'
import {
  browserNetworkSignal,
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
}

export type FollowedSession = SessionFollower & { close(): void }

export type StreamConnection = {
  follow(args: { sessionId: string; cache?: SessionCache | undefined }): FollowedSession
  followSessions(): FollowedSessionList
  connect(): void
  close(): void
  state(): EStreamConnectionState
}

type Followed = {
  id: string
  sessionId: string
  follower: SessionFollower
  subscription: StreamSubscription | undefined
  epoch: number
}

type Listed = {
  list: SessionsList
  subscription: StreamSubscription | undefined
  epoch: number
}

export const createStreamConnection = (args: StreamConnectionArgs): StreamConnection => {
  const { scheduler } = args
  let machine: ConnectionState = initialConnectionState()
  let generation = 0
  let nextId = 0
  let unsubscribeNetwork: (() => void) | undefined
  const timers = new Map<EConnectionTimer, unknown>()
  const followed = new Map<string, Followed>()
  const lists = new Set<Listed>()

  const stopSubscription = (holder: Followed | Listed): void => {
    holder.epoch += 1
    holder.subscription?.close()
    holder.subscription = undefined
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

  const handlersOf = (holder: Followed | Listed, onFrame: (frame: StreamServerMessage) => void) => {
    const epoch = holder.epoch
    const current = (): boolean => epoch === holder.epoch
    return {
      handleFrame: (frame: StreamServerMessage): void => {
        if (current() && !lifecycle(holder, frame)) onFrame(frame)
      },
      handleFailure: (status: number | undefined): void => {
        if (current()) dispatch({ type: 'failure', status })
      },
      handleEnd: (): void => {
        if (current()) dispatch({ type: 'ended' })
      },
    }
  }

  const subscribeFollow = (entry: Followed): void => {
    stopSubscription(entry)
    const cursor = entry.follower.cursor()
    entry.subscription = args.transport.follow(
      {
        sessionId: entry.sessionId,
        ...(cursor === undefined ? {} : { afterSeq: cursor.seq, afterHash: cursor.hash }),
      },
      handlersOf(entry, (frame) => entry.follower.handleMessage(frame)),
    )
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
    entry.subscription = args.transport.list(
      handlersOf(entry, (frame) => {
        if (frame.type === 'snapshot' || frame.type === 'upsert' || frame.type === 'remove') {
          entry.list.handleMessage(frame)
        }
      }),
    )
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

  const resnap = (entry: Followed): void => {
    entry.follower.markResubscribing()
    subscribeFollow(entry)
  }

  const follow: StreamConnection['follow'] = ({ sessionId, cache }) => {
    nextId += 1
    const id = `s${nextId}`
    const entry: Followed = {
      id,
      sessionId,
      follower: createSessionFollower({
        sessionId,
        cache: cache ?? memorySessionCache(),
        scheduler,
        onResnap: () => resnap(entry),
        eventSchema: args.eventSchema,
        knownEventTypes: args.knownEventTypes,
      }),
      subscription: undefined,
      epoch: 0,
    }
    if (machine.phase === EStreamConnectionState.Closed && machine.reason === undefined) {
      dispatch({ type: 'connect' })
    }
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
    const entry: Listed = { list: createSessionsList(), subscription: undefined, epoch: 0 }
    if (machine.phase === EStreamConnectionState.Closed && machine.reason === undefined) {
      dispatch({ type: 'connect' })
    }
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
    close: () => dispatch({ type: 'close-requested' }),
    state: () => machine.phase,
  }
}
