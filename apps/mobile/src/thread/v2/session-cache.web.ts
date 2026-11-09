import {
  browserSessionCache,
  clearBrowserSessionCache,
  memorySessionCache,
  type SessionCache,
} from '@dltech/atlas-client/stream'

import { v2EventSchema } from './registered-plugins'
import { queuedSessionCache, type QueuedSessionCache } from './session-cache-queue'

const factory = (): IDBFactory | undefined =>
  typeof indexedDB === 'undefined' ? undefined : indexedDB

let cache: QueuedSessionCache | undefined

export const sessionCache = (): SessionCache => {
  if (cache !== undefined) return cache
  cache = queuedSessionCache(
    factory() === undefined ? memorySessionCache() : browserSessionCache(v2EventSchema),
  )
  return cache
}

export const clearSessionCache = async (): Promise<void> => {
  cache?.stop()
  await cache?.drain()
  cache = undefined
  await clearBrowserSessionCache(factory())
}
