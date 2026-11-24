import {
  streamServerMessageSchema,
  type EStreamSurface,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'

import { httpStatusOf, type ApiClient } from './client'

export type SessionStreamFollowInput = {
  sessionId: string
  threadId?: string | undefined
  afterSeq?: number | undefined
  afterHash?: string | undefined
  tailViewVersion?: number | undefined
}

export type SessionStreamOlderInput = {
  sessionId: string
  threadId?: string | undefined
  afterSeq: number
  limit: number
}

export type SessionStreamOlderPage = { events: readonly unknown[]; next?: number | undefined }

export type SessionStreamHandlers = {
  handleFrame(frame: StreamServerMessage): void
  handleFailure(status: number | undefined): void
  handleEnd(): void
}

export type SessionStreamSubscription = { close(): void }

export type SessionStreamTransport = {
  follow(
    input: SessionStreamFollowInput,
    handlers: SessionStreamHandlers,
  ): SessionStreamSubscription
  list(handlers: SessionStreamHandlers): SessionStreamSubscription
  events(input: SessionStreamOlderInput): Promise<SessionStreamOlderPage>
}

type ConnectionStateSignal = { state: string; error: unknown }

type StreamObserver = {
  onData(frame: StreamServerMessage): void
  onError(failure: unknown): void
  onComplete(): void
  onConnectionStateChange(state: ConnectionStateSignal): void
}

const isDroppedConnection = (state: ConnectionStateSignal): boolean =>
  state.state === 'connecting' && state.error !== null && state.error !== undefined

const isFrameStream = (value: unknown): value is AsyncIterable<unknown> =>
  typeof (value as { [Symbol.asyncIterator]?: unknown } | null)?.[Symbol.asyncIterator] ===
  'function'

const openSubscription = (args: {
  handlers: SessionStreamHandlers
  handleUnauthorized: (() => void) | undefined
  run(observer: StreamObserver): { unsubscribe(): void }
}): SessionStreamSubscription => {
  let closed = false
  const handleFrame = (value: unknown): void => {
    const parsed = streamServerMessageSchema.safeParse(value)
    if (parsed.success) args.handlers.handleFrame(parsed.data)
  }
  const pump = (frames: AsyncIterable<unknown>): void => {
    void (async () => {
      for await (const frame of frames) {
        if (closed) return
        handleFrame(frame)
      }
    })()
  }
  let teardown: (() => void) | undefined
  const close = (): void => {
    if (closed) return
    closed = true
    teardown?.()
  }
  const subscription = args.run({
    onData: (value) => (isFrameStream(value) ? pump(value) : handleFrame(value)),
    onError: (failure) => {
      if (closed) return
      const status = httpStatusOf(failure)
      if (status === 401) args.handleUnauthorized?.()
      args.handlers.handleFailure(status)
    },
    onComplete: () => {
      if (!closed) args.handlers.handleEnd()
    },
    onConnectionStateChange: (state) => {
      if (closed || !isDroppedConnection(state)) return
      close()
      args.handlers.handleFailure(undefined)
    },
  })
  teardown = () => subscription.unsubscribe()
  return { close }
}

export const sessionStreamTransport = (args: {
  client: ApiClient
  surface?: EStreamSurface | undefined
  handleUnauthorized?: (() => void) | undefined
}): SessionStreamTransport => {
  const { follow, list } = args.client.sessionStream
  return {
    follow: (input, handlers) =>
      openSubscription({
        handlers,
        handleUnauthorized: args.handleUnauthorized,
        run: (observer) =>
          follow.subscribe(
            args.surface === undefined ? input : { ...input, surface: args.surface },
            observer,
          ),
      }),
    list: (handlers) =>
      openSubscription({
        handlers,
        handleUnauthorized: args.handleUnauthorized,
        run: (observer) => list.subscribe(undefined, observer),
      }),
    events: async (input) => {
      const page = await args.client.sessions.events.query({
        sessionId: input.sessionId,
        afterSeq: input.afterSeq,
        limit: input.limit,
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
      })
      return { events: page.events, ...(page.next === undefined ? {} : { next: page.next }) }
    },
  }
}
