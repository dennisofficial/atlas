import pg from 'pg'

import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import { PG_HOST_CHANGE_CHANNEL, PG_WAKE_CHANNEL } from '@dltech/atlas-protocol'

export type PgWakeListener = {
  onWake(listener: (sessionId: string) => void): () => void
  onResync(listener: () => void): () => void
  onHostChange(listener: () => void): () => void
  close(): Promise<void>
}

type WakeNotification = { channel: string; payload?: string | undefined }

export type PgWakeClient = {
  connect(): Promise<unknown>
  query(text: string): Promise<unknown>
  end(): Promise<void>
  on(event: 'notification', listener: (message: WakeNotification) => void): void
  on(event: 'error', listener: (error: unknown) => void): void
  on(event: 'end', listener: () => void): void
}

const RECONNECT_BASE_MS = 250
const RECONNECT_CAP_MS = 5_000

export const startPgWakeListener = (args: {
  url: string
  applicationName?: string | undefined
  createClient?: (() => PgWakeClient) | undefined
  log?: LogPort | undefined
}): PgWakeListener => {
  const wakeListeners = new Set<(sessionId: string) => void>()
  const resyncListeners = new Set<() => void>()
  const hostChangeListeners = new Set<() => void>()
  let closed = false
  let scheduled = false
  let attempt = 0
  let client: PgWakeClient | undefined

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

  const drop = async (dead: PgWakeClient, error?: unknown): Promise<void> => {
    if (closed || client !== dead) return
    client = undefined
    if (error !== undefined) logError('wake listener connection lost', error)
    await dead.end().catch(() => undefined)
    schedule()
  }

  const connect = async (): Promise<void> => {
    const next =
      args.createClient?.() ??
      new pg.Client({
        connectionString: args.url,
        keepAlive: true,
        application_name: args.applicationName ?? 'atlas-wake-listener',
      })
    client = next
    next.on('error', (error: unknown) => void drop(next, error))
    next.on('end', () => void drop(next))
    try {
      await next.connect()
      await next.query(`LISTEN ${PG_WAKE_CHANNEL}; LISTEN ${PG_HOST_CHANGE_CHANNEL}`)
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
    next.on('notification', (message: WakeNotification) => {
      if (message.channel === PG_HOST_CHANGE_CHANNEL) {
        for (const listener of [...hostChangeListeners]) listener()
        return
      }
      if (message.channel !== PG_WAKE_CHANNEL || message.payload === undefined) return
      for (const listener of [...wakeListeners]) listener(message.payload)
    })
    for (const listener of [...resyncListeners]) listener()
    for (const listener of [...hostChangeListeners]) listener()
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

    onHostChange(listener) {
      hostChangeListeners.add(listener)
      return () => {
        hostChangeListeners.delete(listener)
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
