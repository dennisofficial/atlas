import { Redis } from 'ioredis'

import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import type { HostBus } from '@dltech/atlas-host'
import {
  liveFrameSchema,
  sessionLiveChannel,
  WAKE_CHANNEL,
  wakeMessageSchema,
} from '@dltech/atlas-protocol'

export type RedisBus = HostBus & { close(): Promise<void> }

export const createRedisBus = (args: { url: string; log?: LogPort | undefined }): RedisBus => {
  const options = {
    lazyConnect: true,
    // Upstash drops idle TCP connections after ~30 s.
    keepAlive: 10_000,
    maxRetriesPerRequest: 3,
  }
  const publisher = new Redis(args.url, options)
  // ioredis only resubscribes subscriptions it acknowledges, so a wake-channel
  // subscribe that outlives its retries is lost for good: the subscriber retries forever.
  const subscriber = new Redis(args.url, { ...options, maxRetriesPerRequest: null })
  const listeners = new Set<(sessionId: string) => void>()

  const logError = (source: string, message: string, error: unknown): void => {
    args.log?.error({ source, message, ...logFieldsOf({ error }) })
  }

  publisher.on('error', (error: unknown) => {
    logError('bus.publisher', 'redis publisher connection error', error)
  })
  subscriber.on('error', (error: unknown) => {
    logError('bus.subscriber', 'redis subscriber connection error', error)
  })
  subscriber.subscribe(WAKE_CHANNEL).catch((error: unknown) => {
    logError('bus.subscribe', 'subscribing to the wake channel failed', error)
  })
  subscriber.on('message', (channel: string, message: string) => {
    if (channel !== WAKE_CHANNEL) return
    let parsed: unknown
    try {
      parsed = JSON.parse(message)
    } catch (error) {
      logError('bus.wake', 'dropping a malformed wake message', error)
      return
    }
    const result = wakeMessageSchema.safeParse(parsed)
    if (!result.success) {
      logError('bus.wake', 'dropping a malformed wake message', result.error)
      return
    }
    for (const listener of listeners) listener(result.data.sessionId)
  })

  return {
    onWake(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async wake(sessionId) {
      await publisher.publish(WAKE_CHANNEL, JSON.stringify({ sessionId }))
    },

    live({ sessionId, frame }) {
      const result = liveFrameSchema.safeParse(frame)
      if (!result.success) {
        logError('bus.live', 'dropping a malformed live frame', result.error)
        return
      }
      publisher
        .publish(sessionLiveChannel(sessionId), JSON.stringify(result.data))
        .catch((error: unknown) => {
          logError('bus.live', `publishing a live frame for ${sessionId} failed`, error)
        })
    },

    async close() {
      publisher.disconnect()
      subscriber.disconnect()
      await Promise.allSettled([publisher.quit(), subscriber.quit()])
    },
  }
}
