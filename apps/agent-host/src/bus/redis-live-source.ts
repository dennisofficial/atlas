import { Redis } from 'ioredis'

import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import {
  sessionLiveBufferKey,
  sessionLiveChannel,
  sessionShellBacklogKey,
} from '@dltech/atlas-protocol'

import type { LiveSource } from '../stream/live-source'

const CHANNEL_PREFIX = sessionLiveChannel('')

export const createRedisLiveSource = (args: {
  url: string
  log?: LogPort | undefined
}): LiveSource => {
  const options = {
    // Upstash drops idle TCP connections after ~30 s.
    keepAlive: 10_000,
    maxRetriesPerRequest: 3,
  }
  const subscriber = new Redis(args.url, { ...options, autoResubscribe: false })
  const reader = new Redis(args.url, options)
  const channels = new Set<string>()
  const frameListeners = new Set<(args: { sessionId: string; raw: string }) => void>()
  const gapListeners = new Set<() => void>()
  let readyBefore = false
  let closing: Promise<void> | undefined

  const logError = (failure: { message: string; error: unknown }): void => {
    args.log?.error({
      source: 'bus.live',
      message: failure.message,
      ...logFieldsOf({ error: failure.error }),
    })
  }

  const handleReconnected = async (): Promise<void> => {
    if (channels.size > 0) await subscriber.subscribe(...channels)
    for (const listener of [...gapListeners]) listener()
  }

  subscriber.on('error', (error: unknown) =>
    logError({ message: 'redis live subscriber error', error }),
  )
  reader.on('error', (error: unknown) => logError({ message: 'redis live reader error', error }))
  subscriber.on('ready', () => {
    if (!readyBefore) {
      readyBefore = true
      return
    }
    handleReconnected().catch((error: unknown) =>
      logError({ message: 'redis live resubscribe failed', error }),
    )
  })
  subscriber.on('message', (channel: string, raw: string) => {
    if (!channel.startsWith(CHANNEL_PREFIX)) return
    const sessionId = channel.slice(CHANNEL_PREFIX.length)
    for (const listener of [...frameListeners]) listener({ sessionId, raw })
  })

  const quit = async (client: Redis): Promise<void> => {
    await client.quit().catch(() => client.disconnect())
  }

  return {
    async subscribe(sessionId) {
      const channel = sessionLiveChannel(sessionId)
      channels.add(channel)
      await subscriber.subscribe(channel)
    },
    async unsubscribe(sessionId) {
      const channel = sessionLiveChannel(sessionId)
      channels.delete(channel)
      await subscriber.unsubscribe(channel)
    },
    readBuffer: (sessionId) => reader.get(sessionLiveBufferKey(sessionId)),
    readShellBacklog: (sessionId) => reader.lrange(sessionShellBacklogKey(sessionId), 0, -1),
    onFrame(listener) {
      frameListeners.add(listener)
      return () => {
        frameListeners.delete(listener)
      }
    },
    onGap(listener) {
      gapListeners.add(listener)
      return () => {
        gapListeners.delete(listener)
      }
    },
    async close() {
      closing ??= Promise.all([quit(subscriber), quit(reader)]).then(() => undefined)
      await closing
    },
  }
}
