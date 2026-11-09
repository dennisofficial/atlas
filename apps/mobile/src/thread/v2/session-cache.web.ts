import {
  browserSessionCache,
  clearBrowserSessionCache,
  defaultIndexedDbFactory,
  memorySessionCache,
  type SessionCache,
} from '@dltech/atlas-client/stream'

import { v2EventSchema } from './registered-plugins'
import { queuedSessionCache, type QueuedSessionCache } from './session-cache-queue'

let cache: QueuedSessionCache | undefined

export const sessionCache = (): SessionCache => {
  if (cache !== undefined) return cache
  cache = queuedSessionCache(
    defaultIndexedDbFactory() === undefined
      ? memorySessionCache()
      : browserSessionCache(v2EventSchema),
  )
  return cache
}

export const clearSessionCache = async (): Promise<void> => {
  cache?.stop()
  await cache?.drain()
  cache = undefined
  await clearBrowserSessionCache()
}
