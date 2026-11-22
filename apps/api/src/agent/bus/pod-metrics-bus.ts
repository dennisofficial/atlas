import { Redis } from 'ioredis'

import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import {
  POD_METRICS_WATCH_CHANNEL,
  podMetricsChannel,
  podMetricsFrameSchema,
  podMetricsWatchSchema,
  type PodMetricsFrame,
  type PodMetricsWatch,
} from '@dltech/atlas-protocol'

const CHANNEL_PREFIX = podMetricsChannel('')

export type PodMetricsUnsubscribe = () => Promise<void>

export type PodMetricsBus = {
  requestWatch(request: PodMetricsWatch): Promise<void>
  onWatch(listener: (request: PodMetricsWatch) => void): () => void
  publish(args: { sessionId: string; frame: PodMetricsFrame }): Promise<void>
  subscribe(args: {
    sessionId: string
    listener: (frame: PodMetricsFrame) => void
  }): Promise<PodMetricsUnsubscribe>
  close(): Promise<void>
}

export const createPodMetricsBus = (args: {
  url: string
  log?: LogPort | undefined
}): PodMetricsBus => {
  const options = {
    // Upstash drops idle TCP connections after ~30 s.
    keepAlive: 10_000,
    maxRetriesPerRequest: 3,
  }
  const publisher = new Redis(args.url, options)
  const subscriber = new Redis(args.url, { ...options, autoResubscribe: false })
  const watchListeners = new Set<(request: PodMetricsWatch) => void>()
  const frameListeners = new Map<string, Set<(frame: PodMetricsFrame) => void>>()
  const channels = new Set<string>([POD_METRICS_WATCH_CHANNEL])
  let readyBefore = false
  let watchReady: Promise<unknown> | undefined
  let closing: Promise<void> | undefined

  const logError = (failure: { message: string; error: unknown }): void => {
    args.log?.error({
      source: 'bus.pod-metrics',
      message: failure.message,
      ...logFieldsOf({ error: failure.error }),
    })
  }

  const subscribeChannels = (): Promise<unknown> =>
    subscriber.subscribe(...channels).catch((error: unknown) => {
      watchReady = undefined
      logError({ message: 'subscribing to pod metrics channels failed', error })
    })

  const ensureWatchChannel = (): Promise<unknown> => {
    watchReady ??= subscribeChannels()
    return watchReady
  }

  const receiveWatch = (raw: string): void => {
    const parsed = podMetricsWatchSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      logError({ message: 'dropping a malformed pod metrics watch request', error: parsed.error })
      return
    }
    for (const listener of [...watchListeners]) listener(parsed.data)
  }

  const receiveFrame = (sessionId: string, raw: string): void => {
    const listeners = frameListeners.get(sessionId)
    if (listeners === undefined) return
    const parsed = podMetricsFrameSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      logError({ message: 'dropping a malformed pod metrics frame', error: parsed.error })
      return
    }
    for (const listener of [...listeners]) listener(parsed.data)
  }

  publisher.on('error', (error: unknown) =>
    logError({ message: 'redis pod metrics publisher error', error }),
  )
  subscriber.on('error', (error: unknown) =>
    logError({ message: 'redis pod metrics subscriber error', error }),
  )
  subscriber.on('ready', () => {
    if (!readyBefore) {
      readyBefore = true
      return
    }
    void subscribeChannels()
  })
  subscriber.on('message', (channel: string, raw: string) => {
    try {
      if (channel === POD_METRICS_WATCH_CHANNEL) receiveWatch(raw)
      else if (channel.startsWith(CHANNEL_PREFIX)) {
        receiveFrame(channel.slice(CHANNEL_PREFIX.length), raw)
      }
    } catch (error: unknown) {
      logError({ message: 'dropping an unreadable pod metrics message', error })
    }
  })

  const quit = async (client: Redis): Promise<void> => {
    await client.quit().catch(() => client.disconnect())
  }

  return {
    async requestWatch(request) {
      const parsed = podMetricsWatchSchema.safeParse(request)
      if (!parsed.success) {
        logError({ message: 'dropping a malformed pod metrics watch request', error: parsed.error })
        return
      }
      await ensureWatchChannel()
      await publisher
        .publish(POD_METRICS_WATCH_CHANNEL, JSON.stringify(parsed.data))
        .catch((error: unknown) =>
          logError({
            message: `publishing a pod metrics watch request for ${request.sessionId} failed`,
            error,
          }),
        )
    },

    onWatch(listener) {
      watchListeners.add(listener)
      void ensureWatchChannel()
      return () => {
        watchListeners.delete(listener)
      }
    },

    async publish({ sessionId, frame }) {
      const parsed = podMetricsFrameSchema.safeParse(frame)
      if (!parsed.success) {
        logError({ message: 'dropping a malformed pod metrics frame', error: parsed.error })
        return
      }
      await publisher
        .publish(podMetricsChannel(sessionId), JSON.stringify(parsed.data))
        .catch((error: unknown) =>
          logError({ message: `publishing pod metrics for ${sessionId} failed`, error }),
        )
    },

    async subscribe({ sessionId, listener }) {
      const channel = podMetricsChannel(sessionId)
      const listeners = frameListeners.get(sessionId) ?? new Set()
      const first = listeners.size === 0
      listeners.add(listener)
      frameListeners.set(sessionId, listeners)
      if (first) {
        channels.add(channel)
        await subscriber
          .subscribe(channel)
          .catch((error: unknown) =>
            logError({ message: `subscribing to pod metrics for ${sessionId} failed`, error }),
          )
      }
      return async () => {
        const current = frameListeners.get(sessionId)
        if (current === undefined) return
        current.delete(listener)
        if (current.size > 0) return
        frameListeners.delete(sessionId)
        channels.delete(channel)
        await subscriber.unsubscribe(channel).catch(() => undefined)
      }
    },

    async close() {
      closing ??= Promise.all([quit(publisher), quit(subscriber)]).then(() => undefined)
      await closing
    },
  }
}
