import { randomUUID } from 'node:crypto'

import type { PodCallBus } from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import {
  POD_CALL_REQUEST_CHANNEL,
  POD_READY_CHANNEL,
  podCallReplyChannel,
  podCallReplySchema,
  podCallRequestSchema,
  podReadySchema,
  podStreamChannel,
  podStreamFrameSchema,
  type PodCallReplyOutcome,
  type PodCallRequest,
  type PodReady,
  type PodStreamFrame,
} from '@dltech/atlas-protocol'
import type { Redis } from 'ioredis'

import { podCallClientsOf, type PodCallClients } from './pod-call-redis'

const STREAM_CHANNEL_PREFIX = podStreamChannel('')

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const createRedisPodCallBus = (args: {
  url: string
  log?: LogPort | undefined
  clients?: PodCallClients | undefined
}): PodCallBus => {
  const requesterId = randomUUID()
  const replyChannel = podCallReplyChannel(requesterId)
  const { publisher, subscriber } = podCallClientsOf({ url: args.url, clients: args.clients })
  const requestListeners = new Set<(request: PodCallRequest) => void>()
  const readyListeners = new Set<(ready: PodReady) => void>()
  const frameListeners = new Map<string, Set<(frame: PodStreamFrame) => void>>()
  const pending = new Map<string, (outcome: PodCallReplyOutcome) => void>()
  const channels = new Set<string>([POD_CALL_REQUEST_CHANNEL, POD_READY_CHANNEL, replyChannel])
  let readyBefore = false
  let subscribing: Promise<unknown> | undefined
  let closing: Promise<void> | undefined

  const logError = (failure: { message: string; error: unknown }): void => {
    args.log?.error({
      source: 'bus.pod-call',
      message: failure.message,
      ...logFieldsOf({ error: failure.error }),
    })
  }

  const subscribeAll = (): Promise<unknown> =>
    subscriber.subscribe(...channels).catch((error: unknown) => {
      subscribing = undefined
      throw error
    })

  const ensureSubscribed = (): Promise<unknown> => {
    subscribing ??= subscribeAll()
    return subscribing
  }

  const subscribeQuietly = (): void => {
    void subscribeAll().catch((error: unknown) =>
      logError({ message: 'subscribing to pod call channels failed', error }),
    )
  }

  const whenPublisherReady = (): Promise<unknown> =>
    publisher.status === 'ready'
      ? Promise.resolve()
      : new Promise((resolve) => publisher.once('ready', () => resolve()))

  const handleRequest = (raw: string): void => {
    const parsed = podCallRequestSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      logError({ message: 'dropping a malformed pod call request', error: parsed.error })
      return
    }
    for (const listener of [...requestListeners]) listener(parsed.data)
  }

  const handleReady = (raw: string): void => {
    const parsed = podReadySchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      logError({ message: 'dropping a malformed pod ready signal', error: parsed.error })
      return
    }
    for (const listener of [...readyListeners]) listener(parsed.data)
  }

  const handleReply = (raw: string): void => {
    const parsed = podCallReplySchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      logError({ message: 'dropping a malformed pod call reply', error: parsed.error })
      return
    }
    pending.get(parsed.data.requestId)?.(parsed.data.outcome)
  }

  const handleFrame = (streamId: string, raw: string): void => {
    const listeners = frameListeners.get(streamId)
    if (listeners === undefined) return
    const parsed = podStreamFrameSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      logError({
        message: `dropping a malformed pod stream frame for ${streamId}`,
        error: parsed.error,
      })
      return
    }
    for (const listener of [...listeners]) listener(parsed.data)
  }

  const handleMessage = (channel: string, raw: string): void => {
    try {
      if (channel === POD_CALL_REQUEST_CHANNEL) handleRequest(raw)
      else if (channel === POD_READY_CHANNEL) handleReady(raw)
      else if (channel === replyChannel) handleReply(raw)
      else if (channel.startsWith(STREAM_CHANNEL_PREFIX)) {
        handleFrame(channel.slice(STREAM_CHANNEL_PREFIX.length), raw)
      }
    } catch (error: unknown) {
      logError({ message: 'dropping an unreadable pod call message', error })
    }
  }

  publisher.on('error', (error: unknown) =>
    logError({ message: 'redis pod call publisher error', error }),
  )
  subscriber.on('error', (error: unknown) =>
    logError({ message: 'redis pod call subscriber error', error }),
  )
  subscriber.on('ready', () => {
    if (!readyBefore) {
      readyBefore = true
      return
    }
    subscribeQuietly()
  })
  subscriber.on('message', handleMessage)

  const publish = async (args: {
    channel: string
    payload: unknown
    failure: string
  }): Promise<void> => {
    await whenPublisherReady()
    await publisher
      .publish(args.channel, JSON.stringify(args.payload))
      .catch((error: unknown) => logError({ message: args.failure, error }))
  }

  const quit = async (client: Redis): Promise<void> => {
    await client.quit().catch(() => client.disconnect())
  }

  return {
    requesterId,

    async request({ request, timeoutMs, signal }) {
      const parsed = podCallRequestSchema.safeParse(request)
      if (!parsed.success) {
        logError({ message: 'dropping a malformed pod call request', error: parsed.error })
        return { state: 'failed', message: 'malformed pod call request' }
      }
      const { data } = parsed
      return await new Promise<PodCallReplyOutcome>((resolve) => {
        let settled = false
        const finish = (outcome: PodCallReplyOutcome): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', handleAbort)
          if (pending.get(data.requestId) === finish) pending.delete(data.requestId)
          resolve(outcome)
        }
        const handleAbort = (): void => finish({ state: 'failed', message: 'aborted' })
        const timer = setTimeout(
          () =>
            finish({
              state: 'failed',
              message: `${data.kind} timed out after ${timeoutMs}ms`,
            }),
          timeoutMs,
        )
        timer.unref()
        const send = async (): Promise<void> => {
          try {
            await ensureSubscribed()
            await whenPublisherReady()
            if (settled) return
            await publisher.publish(POD_CALL_REQUEST_CHANNEL, JSON.stringify(data))
          } catch (error: unknown) {
            logError({
              message: `publishing a pod call request for ${data.requestId} failed`,
              error,
            })
            finish({ state: 'failed', message: messageOf(error) })
          }
        }
        pending.set(data.requestId, finish)
        if (signal?.aborted === true) {
          finish({ state: 'failed', message: 'aborted' })
          return
        }
        signal?.addEventListener('abort', handleAbort, { once: true })
        void send()
      })
    },

    onRequest(listener) {
      requestListeners.add(listener)
      subscribeQuietly()
      return () => {
        requestListeners.delete(listener)
      }
    },

    async reply({ replyTo, reply }) {
      const parsed = podCallReplySchema.safeParse(reply)
      if (!parsed.success) {
        logError({ message: 'dropping a malformed pod call reply', error: parsed.error })
        return
      }
      await publish({
        channel: podCallReplyChannel(replyTo),
        payload: parsed.data,
        failure: `publishing a pod call reply to ${replyTo} failed`,
      })
    },

    async publishFrame({ streamId, frame }) {
      const parsed = podStreamFrameSchema.safeParse(frame)
      if (!parsed.success) {
        logError({ message: 'dropping a malformed pod stream frame', error: parsed.error })
        return
      }
      await publish({
        channel: podStreamChannel(streamId),
        payload: parsed.data,
        failure: `publishing a pod stream frame for ${streamId} failed`,
      })
    },

    async subscribeFrames({ streamId, listener }) {
      const channel = podStreamChannel(streamId)
      const listeners = frameListeners.get(streamId) ?? new Set()
      listeners.add(listener)
      frameListeners.set(streamId, listeners)
      if (listeners.size === 1) {
        channels.add(channel)
        await subscriber
          .subscribe(channel)
          .catch((error: unknown) =>
            logError({ message: `subscribing to pod stream ${streamId} failed`, error }),
          )
      }
      return async () => {
        const current = frameListeners.get(streamId)
        if (current === undefined) return
        current.delete(listener)
        if (current.size > 0) return
        frameListeners.delete(streamId)
        channels.delete(channel)
        await subscriber.unsubscribe(channel).catch(() => undefined)
      }
    },

    async ready(ready) {
      const parsed = podReadySchema.safeParse(ready)
      if (!parsed.success) {
        logError({ message: 'dropping a malformed pod ready signal', error: parsed.error })
        return
      }
      await publish({
        channel: POD_READY_CHANNEL,
        payload: parsed.data,
        failure: `publishing a pod ready signal for ${ready.sessionId} failed`,
      })
    },

    onReady(listener) {
      readyListeners.add(listener)
      subscribeQuietly()
      return () => {
        readyListeners.delete(listener)
      }
    },

    async close() {
      for (const finish of [...pending.values()]) {
        finish({ state: 'failed', message: 'pod call bus closed' })
      }
      closing ??= Promise.all([quit(publisher), quit(subscriber)]).then(() => undefined)
      await closing
    },
  }
}
