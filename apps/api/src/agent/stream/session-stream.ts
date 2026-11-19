import { randomUUID } from 'node:crypto'

import type { HostTimers } from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import {
  EStreamErrorCode,
  EStreamSubscribeKind,
  EStreamSurface,
  STREAM_PROTOCOL_VERSION,
  streamServerMessageSchema,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'

import { readyFrameOf } from './ready-frame'
import { StreamFrameQueue } from './session-stream-frames'
import { STREAM_DRAIN_RECONNECT_SPREAD_MS } from './stream-limits'
import { createTrailingFlush } from './trailing-flush'
import {
  unimplementedSubscriptions,
  type OutgoingFrame,
  type StreamSubscriptionMessage,
  type SubscriptionPort,
} from './subscription-port'
import type { UserSlots } from './user-slots'

export class SessionStreamLimitError extends Error {
  constructor() {
    super('too many stream subscriptions for this user')
  }
}

export type SessionStreamDeps = {
  users: UserSlots
  timers: HostTimers
  eventTypes: readonly string[] | undefined
  log: LogPort | undefined
}

export type SessionStreamFollowArgs = {
  userId: string
  sessionId: string
  surface?: EStreamSurface | undefined
  afterSeq?: number | undefined
  afterHash?: string | undefined
  signal?: AbortSignal | undefined
}

export type SessionStreamListArgs = {
  userId: string
  signal?: AbortSignal | undefined
}

export type SessionStream = {
  start(args: { subscriptions: SubscriptionPort }): void
  follow(args: SessionStreamFollowArgs): AsyncGenerator<StreamServerMessage>
  list(args: SessionStreamListArgs): AsyncGenerator<StreamServerMessage>
  connections(): number
  isDraining(): boolean
  drain(): void
  stop(): void
}

type OpenSubscription = {
  userId: string
  surface: EStreamSurface
  signal: AbortSignal | undefined
  queue: StreamFrameQueue
  subscribe: (id: string) => StreamSubscriptionMessage
}

const messageOf = (frame: OutgoingFrame): StreamServerMessage =>
  streamServerMessageSchema.parse(frame)

export const createSessionStream = (deps: SessionStreamDeps): SessionStream => {
  const open = new Set<StreamFrameQueue>()
  let subscriptions: SubscriptionPort = unimplementedSubscriptions
  let draining = false

  async function* frames(args: OpenSubscription): AsyncGenerator<StreamServerMessage> {
    if (!deps.users.acquire(args.userId)) throw new SessionStreamLimitError()
    const { queue } = args
    const id = randomUUID()
    const flush = createTrailingFlush({ send: (frame) => queue.push(frame) })
    const session = subscriptions.open({
      userId: args.userId,
      version: STREAM_PROTOCOL_VERSION,
      surface: args.surface,
      send: (frame) => {
        queue.push(frame)
        flush.afterSend()
      },
      bufferedAmount: () => queue.bufferedAmount(),
      close: () => queue.end(),
    })
    const abort = (): void => queue.end()
    args.signal?.addEventListener('abort', abort, { once: true })
    if (args.signal?.aborted === true) queue.end()
    open.add(queue)
    try {
      yield readyFrameOf({
        version: STREAM_PROTOCOL_VERSION,
        connectionId: id,
        eventTypes: deps.eventTypes,
      })
      flush.afterSend()
      Promise.resolve(session.handle(args.subscribe(id))).catch((error: unknown) => {
        deps.log?.error({
          source: 'stream',
          message: 'session stream subscribe failed',
          ...logFieldsOf({ error }),
        })
        queue.push({ type: 'error', id, code: EStreamErrorCode.Internal })
        queue.end()
      })
      for (;;) {
        const step = await queue.next()
        if (step.kind === 'end') return
        if (step.kind === 'drain') {
          yield { type: 'going-away', reconnectAfterMs: step.reconnectAfterMs }
          return
        }
        yield messageOf(step.frame)
        session.drain()
      }
    } finally {
      args.signal?.removeEventListener('abort', abort)
      open.delete(queue)
      queue.end()
      session.close()
      deps.users.release(args.userId)
    }
  }

  const endAll = (end: (queue: StreamFrameQueue) => void): void => {
    draining = true
    for (const queue of [...open]) end(queue)
  }

  return {
    start: (args) => {
      subscriptions = args.subscriptions
    },
    follow: (args) =>
      frames({
        userId: args.userId,
        surface: args.surface ?? EStreamSurface.Web,
        signal: args.signal,
        queue: new StreamFrameQueue(),
        subscribe: (id) => ({
          type: 'subscribe',
          id,
          kind: EStreamSubscribeKind.Session,
          sessionId: args.sessionId,
          ...(args.afterSeq === undefined ? {} : { afterSeq: args.afterSeq }),
          ...(args.afterHash === undefined ? {} : { afterHash: args.afterHash }),
        }),
      }),
    list: (args) =>
      frames({
        userId: args.userId,
        surface: EStreamSurface.Web,
        signal: args.signal,
        queue: new StreamFrameQueue(),
        subscribe: (id) => ({ type: 'subscribe', id, kind: EStreamSubscribeKind.Sessions }),
      }),
    connections: () => open.size,
    isDraining: () => draining,
    drain: () =>
      endAll((queue) =>
        queue.drain(Math.floor(deps.timers.random() * STREAM_DRAIN_RECONNECT_SPREAD_MS)),
      ),
    stop: () => endAll((queue) => queue.end()),
  }
}
