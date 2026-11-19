import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import {
  MAC_LINK_PRESENCE_TTL_SECONDS,
  macLinkChannel,
  macLinkPresenceKey,
  macRelayFrameSchema,
  type MacRelayFrame,
} from '@dltech/atlas-protocol/mac-link'
import { Redis } from 'ioredis'

export type MacPresence = { instanceId: string; deviceId: string }

export type MacLinkRelay = {
  presence(userId: string): Promise<MacPresence | undefined>
  claim(userId: string, presence: MacPresence): Promise<void>
  release(userId: string, instanceId: string): Promise<void>
  publish(userId: string, frame: MacRelayFrame): Promise<void>
  listen(userId: string, listener: (frame: MacRelayFrame) => void): Promise<() => Promise<void>>
  close(): Promise<void>
}

export type MacRelayRedis = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>
  del(key: string): Promise<number>
  publish(channel: string, message: string): Promise<number>
  subscribe(channel: string): Promise<unknown>
  unsubscribe(channel: string): Promise<unknown>
  on(event: 'ready' | 'error' | 'message', listener: (...args: never[]) => void): unknown
  quit(): Promise<unknown>
  disconnect(): void
}

const presenceOf = (raw: string | null): MacPresence | undefined => {
  if (raw === null) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { instanceId, deviceId } = parsed as Partial<MacPresence>
    if (typeof instanceId !== 'string' || typeof deviceId !== 'string') return undefined
    return { instanceId, deviceId }
  } catch {
    return undefined
  }
}

export const createMacLinkRelay = (args: {
  url: string
  instanceId: string
  log?: LogPort | undefined
  clients?: { publisher: MacRelayRedis; subscriber: MacRelayRedis } | undefined
}): MacLinkRelay => {
  const options = { keepAlive: 10_000, maxRetriesPerRequest: 3 }
  const publisher =
    args.clients?.publisher ?? (new Redis(args.url, options) as unknown as MacRelayRedis)
  const subscriber =
    args.clients?.subscriber ??
    (new Redis(args.url, { ...options, autoResubscribe: false }) as unknown as MacRelayRedis)
  const listeners = new Map<string, Set<(frame: MacRelayFrame) => void>>()
  let closing: Promise<void> | undefined

  const logError = (message: string, error: unknown): void => {
    args.log?.error({ source: 'bus.mac-link', message, ...logFieldsOf({ error }) })
  }

  const deliver = (channel: string, raw: string): void => {
    const parsed = macRelayFrameSchema.safeParse(safeJson(raw))
    if (!parsed.success) {
      logError('dropped a malformed mac relay frame', parsed.error)
      return
    }
    if (parsed.data.origin === args.instanceId) return
    for (const listener of [...(listeners.get(channel) ?? [])]) listener(parsed.data)
  }

  subscriber.on('error', (error) => logError('redis mac-link subscriber error', error))
  publisher.on('error', (error) => logError('redis mac-link publisher error', error))
  subscriber.on('ready', () => {
    const channels = [...listeners.keys()]
    if (channels.length === 0) return
    void subscriber
      .subscribe(...channels)
      .catch((error: unknown) => logError('redis mac-link resubscribe failed', error))
  })
  subscriber.on('message', (channel, raw) => deliver(channel as string, raw as string))

  const quit = async (client: MacRelayRedis): Promise<void> => {
    await client.quit().catch(() => client.disconnect())
  }

  return {
    async presence(userId) {
      try {
        return presenceOf(await publisher.get(macLinkPresenceKey(userId)))
      } catch (error) {
        logError('redis mac-link presence read failed', error)
        return undefined
      }
    },
    async claim(userId, presence) {
      await publisher.set(
        macLinkPresenceKey(userId),
        JSON.stringify(presence),
        'EX',
        MAC_LINK_PRESENCE_TTL_SECONDS,
      )
    },
    async release(userId, instanceId) {
      const current = presenceOf(await publisher.get(macLinkPresenceKey(userId)))
      if (current === undefined || current.instanceId !== instanceId) return
      await publisher.del(macLinkPresenceKey(userId))
    },
    async publish(userId, frame) {
      await publisher.publish(macLinkChannel(userId), JSON.stringify(frame))
    },
    async listen(userId, listener) {
      const channel = macLinkChannel(userId)
      const existing = listeners.get(channel)
      if (existing === undefined) {
        listeners.set(channel, new Set([listener]))
        await subscriber.subscribe(channel)
      } else {
        existing.add(listener)
      }
      let released = false
      return async () => {
        if (released) return
        released = true
        const current = listeners.get(channel)
        current?.delete(listener)
        if (current === undefined || current.size > 0) return
        listeners.delete(channel)
        await subscriber.unsubscribe(channel)
      }
    },
    async close() {
      closing ??= Promise.all([quit(subscriber), quit(publisher)]).then(() => undefined)
      await closing
    },
  }
}

const safeJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}
