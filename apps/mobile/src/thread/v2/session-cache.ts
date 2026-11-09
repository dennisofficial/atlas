import { memorySessionCache, type SessionCache } from '@dltech/atlas-client/stream'

import { kvJsonStore } from '../../storage/kv-json-store'
import type { JsonStore } from '../../storage/json-store'
import { v2EventSchema } from './registered-plugins'
import { queuedSessionCache, type QueuedSessionCache } from './session-cache-queue'
import { createStoredSessionCache } from './session-cache-store'

export const SESSION_CACHE_DATABASE = 'atlas-sessions'

let store: JsonStore | undefined
let cache: QueuedSessionCache | undefined

const storeOf = (): JsonStore => {
  store ??= kvJsonStore({ database: SESSION_CACHE_DATABASE })
  return store
}

export const sessionCache = (): SessionCache => {
  if (cache !== undefined) return cache
  try {
    cache = queuedSessionCache(
      createStoredSessionCache({
        store: storeOf(),
        now: () => Date.now(),
        eventSchema: v2EventSchema,
      }),
    )
  } catch {
    cache = queuedSessionCache(memorySessionCache())
  }
  return cache
}

export const clearSessionCache = async (): Promise<void> => {
  cache?.stop()
  await cache?.drain()
  cache = undefined
  await storeOf()
    .clear()
    .catch(() => undefined)
}
