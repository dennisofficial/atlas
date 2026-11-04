import { Redis } from 'ioredis'

import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import { liveFrameSchema, sessionLiveChannel, type LiveFrame } from '@dltech/atlas-protocol'

export type RedisLiveFrames = {
  live(args: { sessionId: string; frame: LiveFrame }): void
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

  return {
    live({ sessionId, frame }) {
      const result = liveFrameSchema.safeParse(frame)
      if (!result.success) {
        args.log?.error({
          source: 'bus.live',
          message: 'dropping a malformed live frame',
          ...logFieldsOf({ error: result.error }),
        })
        return
      }
      publisher
        .publish(sessionLiveChannel(sessionId), JSON.stringify(result.data))
        .catch((error: unknown) => {
          args.log?.error({
            source: 'bus.live',
            message: `publishing a live frame for ${sessionId} failed`,
            ...logFieldsOf({ error }),
          })
        })
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
