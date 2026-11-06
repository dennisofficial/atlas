import {
  EStreamSubscribeKind,
  type StreamClientMessage,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'

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
import { createSessionFollower, ESessionConnection, type SessionFollower } from './session-follower'
import {
  browserNetworkSignal,
  type StreamNetworkSignal,
  type StreamScheduler,
  type StreamSocket,
  type StreamSocketFactory,
} from './stream-ports'

export type StreamConnectionArgs = {
  url: string
  getToken(): Promise<string>
  socket: StreamSocketFactory
  scheduler: StreamScheduler
  networkSignal?: StreamNetworkSignal | undefined
}

export type FollowedSession = SessionFollower & { close(): void }

export type StreamConnection = {
  follow(args: { sessionId: string; cache?: SessionCache | undefined }): FollowedSession
  connect(): void
  close(): void
  state(): EStreamConnectionState
}

type Followed = { id: string; sessionId: string; follower: SessionFollower }

export const createStreamConnection = (args: StreamConnectionArgs): StreamConnection => {
  const { scheduler } = args
  let machine: ConnectionState = initialConnectionState()
  let socket: StreamSocket | undefined
  let generation = 0
  let nextId = 0
  let unsubscribeNetwork: (() => void) | undefined
  const timers = new Map<EConnectionTimer, unknown>()
  const followed = new Map<string, Followed>()

  const sendMessage = (message: StreamClientMessage): void => {
    socket?.send(JSON.stringify(message))
  }

  const subscribeMessageOf = (entry: Followed): StreamClientMessage => {
    const cursor = entry.follower.cursor()
    const base = {
      type: 'subscribe',
      id: entry.id,
      kind: EStreamSubscribeKind.Session,
      sessionId: entry.sessionId,
    } as const
    if (cursor === undefined) return base
    return { ...base, afterSeq: cursor.seq, afterHash: cursor.hash }
  }

  const subscribeWhenHydrated = (entry: Followed): void => {
    const born = generation
    void entry.follower.hydrated.then(() => {
      const current = followed.get(entry.id) === entry
      if (!current || born !== generation || machine.phase !== EStreamConnectionState.Open) return
      sendMessage(subscribeMessageOf(entry))
    })
  }

  const dropSocket = (): void => {
    generation += 1
    socket = undefined
  }

  const openSocket = (): void => {
    generation += 1
    const born = generation
    const isCurrent = (): boolean => born === generation
    socket = args.socket({
      url: args.url,
      handlers: {
        handleOpen: () => {
          if (!isCurrent()) return
          args
            .getToken()
            .then((token) => isCurrent() && dispatch({ type: 'socket-opened', token }))
            .catch(() => isCurrent() && dispatch({ type: 'token-failed' }))
        },
        handleMessage: (data) => {
          if (isCurrent()) dispatch({ type: 'message', data })
        },
        handleClose: (code) => {
          if (!isCurrent()) return
          dropSocket()
          dispatch({ type: 'socket-closed', code })
        },
      },
    })
  }

  const schedule = (args: { timer: EConnectionTimer; ms: number }): void => {
    cancel(args.timer)
    timers.set(
      args.timer,
      scheduler.setTimeout(() => {
        timers.delete(args.timer)
        dispatch({ type: 'timer-fired', timer: args.timer })
      }, args.ms),
    )
  }

  const cancel = (timer: EConnectionTimer): void => {
    if (!timers.has(timer)) return
    scheduler.clearTimeout(timers.get(timer))
    timers.delete(timer)
  }

  const stopFollowing = (entry: Followed): boolean => {
    if (followed.get(entry.id) !== entry) return false
    followed.delete(entry.id)
    if (machine.phase === EStreamConnectionState.Open) {
      sendMessage({ type: 'unsubscribe', id: entry.id })
    }
    return true
  }

  const deliver = (message: StreamServerMessage): void => {
    if (message.type === 'ready') {
      for (const entry of followed.values()) {
        entry.follower.markResubscribing()
        subscribeWhenHydrated(entry)
      }
      return
    }
    if (!('id' in message) || message.id === undefined) return
    const entry = followed.get(message.id)
    if (entry === undefined) return
    entry.follower.handleMessage(message)
    if (entry.follower.getSnapshot().connection === ESessionConnection.Outdated)
      stopFollowing(entry)
  }

  const run = (effect: ConnectionEffect): void => {
    if (effect.type === 'openSocket') openSocket()
    else if (effect.type === 'closeSocket') {
      socket?.close()
      dropSocket()
    } else if (effect.type === 'send') sendMessage(effect.message)
    else if (effect.type === 'schedule') schedule(effect)
    else if (effect.type === 'cancel') cancel(effect.timer)
    else deliver(effect.message)
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

  const dispatch = (input: ConnectionInput): void => {
    const before = machine.phase
    const step = reduceConnection({
      state: machine,
      input,
      now: scheduler.now(),
      random: scheduler.random(),
    })
    machine = step.state
    if (machine.phase !== before) {
      for (const entry of followed.values()) entry.follower.setConnection(machine.phase)
      watchNetwork(machine.phase)
    }
    for (const effect of step.effects) run(effect)
  }

  const follow: StreamConnection['follow'] = ({ sessionId, cache }) => {
    nextId += 1
    const id = `s${nextId}`
    const follower = createSessionFollower({
      sessionId,
      cache: cache ?? memorySessionCache(),
      scheduler,
      onResnap: () => sendMessage({ type: 'resnap', id }),
    })
    const entry: Followed = { id, sessionId, follower }
    followed.set(id, entry)
    follower.setConnection(machine.phase)
    if (machine.phase === EStreamConnectionState.Open) subscribeWhenHydrated(entry)
    if (machine.phase === EStreamConnectionState.Closed && machine.reason === undefined) {
      dispatch({ type: 'connect' })
    }
    return {
      ...follower,
      close: () => void stopFollowing(entry),
    }
  }

  return {
    follow,
    connect: () => dispatch({ type: 'connect' }),
    close: () => dispatch({ type: 'close-requested' }),
    state: () => machine.phase,
  }
}
