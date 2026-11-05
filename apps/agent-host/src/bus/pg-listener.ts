import pg from 'pg'

import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

export type PgListener = {
  on(channel: string, listener: (payload: string) => void): () => void
  onReconnect(listener: () => void): () => void
  close(): Promise<void>
}

type ListenerNotification = { channel: string; payload?: string | undefined }

export type PgListenerClient = {
  connect(): Promise<unknown>
  query(text: string): Promise<unknown>
  end(): Promise<void>
  on(event: 'notification', listener: (message: ListenerNotification) => void): void
  on(event: 'error', listener: (error: unknown) => void): void
  on(event: 'end', listener: () => void): void
}

const RECONNECT_BASE_MS = 250
const RECONNECT_CAP_MS = 5_000

export const startPgListener = (args: {
  url: string
  channels: readonly string[]
  applicationName?: string | undefined
  createClient?: (() => PgListenerClient) | undefined
  log?: LogPort | undefined
  source?: string | undefined
}): PgListener => {
  const channelListeners = new Map<string, Set<(payload: string) => void>>()
  const reconnectListeners = new Set<() => void>()
  const source = args.source ?? 'bus.pg-listener'
  let closed = false
  let scheduled = false
  let attempt = 0
  let client: PgListenerClient | undefined

  const logError = (message: string, error: unknown): void => {
    args.log?.error({ source, message, ...logFieldsOf({ error }) })
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

  const drop = async (dead: PgListenerClient, error?: unknown): Promise<void> => {
    if (closed || client !== dead) return
    client = undefined
    if (error !== undefined) logError('listener connection lost', error)
    await dead.end().catch(() => undefined)
    schedule()
  }

  const connect = async (): Promise<void> => {
    const next =
      args.createClient?.() ??
      new pg.Client({
        connectionString: args.url,
        keepAlive: true,
        application_name: args.applicationName ?? 'atlas-pg-listener',
      })
    client = next
    next.on('error', (error: unknown) => void drop(next, error))
    next.on('end', () => void drop(next))
    try {
      await next.connect()
      await next.query(args.channels.map((channel) => `LISTEN ${channel}`).join('; '))
    } catch (error) {
      if (!closed) {
        logError('listener connect failed', error)
        await drop(next)
      }
      return
    }
    if (closed) {
      await next.end().catch(() => undefined)
      return
    }
    attempt = 0
    next.on('notification', (message: ListenerNotification) => {
      if (message.payload === undefined) return
      for (const listener of [...(channelListeners.get(message.channel) ?? [])]) {
        listener(message.payload)
      }
    })
    for (const listener of [...reconnectListeners]) listener()
  }

  void connect()

  return {
    on(channel, listener) {
      const set = channelListeners.get(channel) ?? new Set()
      set.add(listener)
      channelListeners.set(channel, set)
      return () => {
        set.delete(listener)
      }
    },

    onReconnect(listener) {
      reconnectListeners.add(listener)
      return () => {
        reconnectListeners.delete(listener)
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
