import pg from 'pg'

import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import { PG_WAKE_CHANNEL } from '@dltech/atlas-protocol'

export type PgWakeListener = {
  onWake(listener: (sessionId: string) => void): () => void
  onResync(listener: () => void): () => void
  close(): Promise<void>
}

const RECONNECT_BASE_MS = 250
const RECONNECT_CAP_MS = 5_000

export const startPgWakeListener = (args: {
  url: string
  applicationName?: string | undefined
  log?: LogPort | undefined
}): PgWakeListener => {
  const wakeListeners = new Set<(sessionId: string) => void>()
  const resyncListeners = new Set<() => void>()
  let closed = false
  let scheduled = false
  let attempt = 0
  let client: pg.Client | undefined

  const logError = (message: string, error: unknown): void => {
    args.log?.error({ source: 'bus.pg-wake', message, ...logFieldsOf({ error }) })
  }

  const schedule = (): void => {
    if (closed || scheduled) return
    scheduled = true
    attempt += 1
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_CAP_MS)
    setTimeout(() => {
      scheduled = false
      if (!closed) void connect()
    }, delay)
  }

  const drop = async (dead: pg.Client, error?: unknown): Promise<void> => {
    if (closed || client !== dead) return
    if (error !== undefined) logError('wake listener connection lost', error)
    await dead.end().catch(() => undefined)
    schedule()
  }

  const connect = async (): Promise<void> => {
    const next = new pg.Client({
      connectionString: args.url,
      keepAlive: true,
      application_name: args.applicationName ?? 'atlas-wake-listener',
    })
    client = next
    try {
      await next.connect()
      await next.query(`LISTEN ${PG_WAKE_CHANNEL}`)
    } catch (error) {
      if (!closed) {
        logError('wake listener connect failed', error)
        await drop(next)
      }
      return
    }
    if (closed) {
      await next.end().catch(() => undefined)
      return
    }
    attempt = 0
    next.on('notification', (message) => {
      if (message.channel !== PG_WAKE_CHANNEL || message.payload === undefined) return
      for (const listener of [...wakeListeners]) listener(message.payload)
    })
    next.on('error', (error: unknown) => void drop(next, error))
    next.on('end', () => void drop(next))
    for (const listener of [...resyncListeners]) listener()
  }

  void connect()

  return {
    onWake(listener) {
      wakeListeners.add(listener)
      return () => {
        wakeListeners.delete(listener)
      }
    },

    onResync(listener) {
      resyncListeners.add(listener)
      return () => {
        resyncListeners.delete(listener)
      }
    },

    async close() {
      closed = true
      const current = client
      client = undefined
      await current?.end().catch(() => undefined)
    },
  }
}
