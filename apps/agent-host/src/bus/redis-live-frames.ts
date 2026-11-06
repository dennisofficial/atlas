import { Redis } from 'ioredis'

import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import {
  liveFrameSchema,
  sessionLiveBufferKey,
  sessionLiveChannel,
  type LiveFrame,
} from '@dltech/atlas-protocol'

export const LIVE_BUFFER_TTL_SECONDS = 600
export const LIVE_BUFFER_EXPIRE_EVERY_MS = 1_000

export type RedisLiveFrames = {
  live(args: { sessionId: string; frame: LiveFrame }): Promise<void>
  trackedSessions(): number
  close(): Promise<void>
}

export const createRedisLiveFrames = (args: {
  url: string
  log?: LogPort | undefined
}): RedisLiveFrames => {
  const publisher = new Redis(args.url, {
    lazyConnect: true,
    // Upstash drops idle TCP connections after ~30 s.
    keepAlive: 10_000,
    maxRetriesPerRequest: 3,
  })

  publisher.on('error', (error: unknown) => {
    args.log?.error({
      source: 'bus.live',
      message: 'redis publisher connection error',
      ...logFieldsOf({ error }),
    })
  })

  let closing: Promise<void> | undefined
  const expiredAt = new Map<string, number>()

  const publishStepFrame = (args: { sessionId: string; frame: LiveFrame }): Promise<unknown> => {
    const { sessionId, frame } = args
    const json = JSON.stringify(frame)
    const bufferKey = sessionLiveBufferKey(sessionId)
    const line = `${json}\n`
    const multi = publisher.multi()
    if (frame.type === 'step-start') multi.set(bufferKey, line)
    else multi.append(bufferKey, line)
    multi.publish(sessionLiveChannel(sessionId), json)
    const now = Date.now()
    const ended = frame.type === 'step-end'
    const due = now - (expiredAt.get(sessionId) ?? 0) >= LIVE_BUFFER_EXPIRE_EVERY_MS
    if (frame.type === 'step-start' || ended || due) {
      multi.expire(bufferKey, LIVE_BUFFER_TTL_SECONDS)
      if (ended) expiredAt.delete(sessionId)
      else expiredAt.set(sessionId, now)
    }
    return multi.exec()
  }

  return {
    async live({ sessionId, frame }) {
      const result = liveFrameSchema.safeParse(frame)
      if (!result.success) {
        args.log?.error({
          source: 'bus.live',
          message: 'dropping a malformed live frame',
          ...logFieldsOf({ error: result.error }),
        })
        return
      }
      const { data } = result
      const sent =
        data.type === 'step-start' || data.type === 'delta' || data.type === 'step-end'
          ? publishStepFrame({ sessionId, frame: data })
          : publisher.publish(sessionLiveChannel(sessionId), JSON.stringify(data))
      await sent.catch((error: unknown) => {
        args.log?.error({
          source: 'bus.live',
          message: `publishing a live frame for ${sessionId} failed`,
          ...logFieldsOf({ error }),
        })
        throw error
      })
    },

    trackedSessions() {
      return expiredAt.size
    },

    async close() {
      closing ??= publisher.quit().then(
        () => undefined,
        (error: unknown) => {
          args.log?.error({
            source: 'bus.live',
            message: 'redis publisher close failed',
            ...logFieldsOf({ error }),
          })
        },
      )
      await closing
    },
  }
}
