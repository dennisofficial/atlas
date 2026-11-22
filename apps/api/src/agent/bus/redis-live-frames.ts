import { Redis } from 'ioredis'

import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import {
  liveFrameSchema,
  PANEL_HOLD_CHANNEL,
  panelHoldSchema,
  sessionLiveBufferKey,
  sessionLiveChannel,
  sessionShellBacklogKey,
  SHELL_BACKLOG_FRAMES,
  SHELL_BACKLOG_TTL_SECONDS,
  type LiveFrame,
  type PanelHold,
} from '@dltech/atlas-protocol'

export const LIVE_BUFFER_TTL_SECONDS = 600
export const LIVE_BUFFER_EXPIRE_EVERY_MS = 1_000

export type RedisLiveFrames = {
  live(args: { key: string; frame: LiveFrame }): Promise<void>
  hold(hold: PanelHold): Promise<void>
  onHold(listener: (hold: PanelHold) => void): () => void
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
  let subscriber: Redis | undefined
  const holdListeners = new Set<(hold: PanelHold) => void>()
  const expiredAt = new Map<string, number>()

  const receiveHold = (raw: string): void => {
    const parsed = panelHoldSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      args.log?.error({
        source: 'bus.hold',
        message: 'dropping a malformed panel hold',
        ...logFieldsOf({ error: parsed.error }),
      })
      return
    }
    for (const listener of [...holdListeners]) listener(parsed.data)
  }

  const startSubscriber = (): Redis => {
    const client = new Redis(args.url, { lazyConnect: true, keepAlive: 10_000 })
    client.on('error', (error: unknown) => {
      args.log?.error({
        source: 'bus.hold',
        message: 'redis hold subscriber connection error',
        ...logFieldsOf({ error }),
      })
    })
    client.on('message', (_channel: string, message: string) => {
      try {
        receiveHold(message)
      } catch (error: unknown) {
        args.log?.error({
          source: 'bus.hold',
          message: 'dropping an unreadable panel hold',
          ...logFieldsOf({ error }),
        })
      }
    })
    void client
      .connect()
      .then(() => client.subscribe(PANEL_HOLD_CHANNEL))
      .catch((error: unknown) => {
        args.log?.error({
          source: 'bus.hold',
          message: 'subscribing to panel holds failed',
          ...logFieldsOf({ error }),
        })
      })
    return client
  }

  const publishStepFrame = (args: { key: string; frame: LiveFrame }): Promise<unknown> => {
    const { key, frame } = args
    const json = JSON.stringify(frame)
    const bufferKey = sessionLiveBufferKey(key)
    const line = `${json}\n`
    const multi = publisher.multi()
    if (frame.type === 'step-start') multi.set(bufferKey, line)
    else multi.append(bufferKey, line)
    multi.publish(sessionLiveChannel(key), json)
    const now = Date.now()
    const ended = frame.type === 'step-end'
    const due = now - (expiredAt.get(key) ?? 0) >= LIVE_BUFFER_EXPIRE_EVERY_MS
    if (frame.type === 'step-start' || ended || due) {
      multi.expire(bufferKey, LIVE_BUFFER_TTL_SECONDS)
      if (ended) expiredAt.delete(key)
      else expiredAt.set(key, now)
    }
    return multi.exec()
  }

  const publishShellFrame = (args: { key: string; frame: LiveFrame }): Promise<unknown> => {
    const { key, frame } = args
    const json = JSON.stringify(frame)
    const backlogKey = sessionShellBacklogKey(key)
    return publisher
      .multi()
      .rpush(backlogKey, json)
      .ltrim(backlogKey, -SHELL_BACKLOG_FRAMES, -1)
      .expire(backlogKey, SHELL_BACKLOG_TTL_SECONDS)
      .publish(sessionLiveChannel(key), json)
      .exec()
  }

  return {
    async live({ key, frame }) {
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
        data.type === 'shell-output'
          ? publishShellFrame({ key, frame: data })
          : data.type === 'step-start' || data.type === 'delta' || data.type === 'step-end'
            ? publishStepFrame({ key, frame: data })
            : publisher.publish(sessionLiveChannel(key), JSON.stringify(data))
      await sent.catch((error: unknown) => {
        args.log?.error({
          source: 'bus.live',
          message: `publishing a live frame for ${key} failed`,
          ...logFieldsOf({ error }),
        })
        throw error
      })
    },

    hold(hold) {
      return publisher
        .publish(PANEL_HOLD_CHANNEL, JSON.stringify(hold))
        .then(() => undefined)
        .catch((error: unknown) => {
          args.log?.error({
            source: 'bus.hold',
            message: `publishing a panel hold for ${hold.sessionId} failed`,
            ...logFieldsOf({ error }),
          })
          throw error
        })
    },

    onHold(listener) {
      subscriber ??= startSubscriber()
      holdListeners.add(listener)
      return () => {
        holdListeners.delete(listener)
      }
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
      await subscriber?.quit().catch(() => undefined)
    },
  }
}
