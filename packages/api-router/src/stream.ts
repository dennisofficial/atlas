import { streamServerMessageSchema, type StreamServerMessage } from '@dltech/atlas-protocol'

import { httpStatusOf, type ApiClient } from './client'

export type SessionStreamFollowInput = {
  sessionId: string
  afterSeq?: number | undefined
  afterHash?: string | undefined
}

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
}

type SubscriptionOptions = {
  next?(value: unknown): void
  error?(failure: unknown): void
  complete?(): void
}

type SubscriptionProcedure<Input> = {
  subscribe(input: Input, options: SubscriptionOptions): { unsubscribe(): void }
}

const isFrameStream = (value: unknown): value is AsyncIterable<unknown> =>
  typeof (value as { [Symbol.asyncIterator]?: unknown } | null)?.[Symbol.asyncIterator] ===
  'function'

const openSubscription = (args: {
  handlers: SessionStreamHandlers
  handleUnauthorized: (() => void) | undefined
  run(observer: SubscriptionOptions): { unsubscribe(): void }
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
  const subscription = args.run({
    next: (value) => (isFrameStream(value) ? pump(value) : handleFrame(value)),
    error: (failure) => {
      if (closed) return
      const status = httpStatusOf(failure)
      if (status === 401) args.handleUnauthorized?.()
      args.handlers.handleFailure(status)
    },
    complete: () => {
      if (!closed) args.handlers.handleEnd()
    },
  })
  return {
    close: () => {
      if (closed) return
      closed = true
      subscription.unsubscribe()
    },
  }
}

export const sessionStreamTransport = (args: {
  client: ApiClient
  handleUnauthorized?: (() => void) | undefined
}): SessionStreamTransport => {
  const follow = args.client.sessionStream
    .follow as unknown as SubscriptionProcedure<SessionStreamFollowInput>
  const list = args.client.sessionStream.list as unknown as SubscriptionProcedure<undefined>
  return {
    follow: (input, handlers) =>
      openSubscription({
        handlers,
        handleUnauthorized: args.handleUnauthorized,
        run: (observer) => follow.subscribe(input, observer),
      }),
    list: (handlers) =>
      openSubscription({
        handlers,
        handleUnauthorized: args.handleUnauthorized,
        run: (observer) => list.subscribe(undefined, observer),
      }),
  }
}
