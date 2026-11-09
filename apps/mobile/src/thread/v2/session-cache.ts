import { memorySessionCache, type SessionCache } from '@dltech/atlas-client/stream'

import { fileJsonStore } from '../../storage/file-json-store'
import { v2EventSchema } from './registered-plugins'
import { createStoredSessionCache } from './session-cache-store'

export const SESSION_CACHE_PATH = ['atlas', 'sessions'] as const

let cache: SessionCache | undefined

export const sessionCache = (): SessionCache => {
  if (cache !== undefined) return cache
  try {
    cache = createStoredSessionCache({
      store: fileJsonStore({ path: SESSION_CACHE_PATH }),
      now: () => Date.now(),
      eventSchema: v2EventSchema,
    })
  } catch {
    cache = memorySessionCache()
  }
  return cache
}

export const clearSessionCache = async (): Promise<void> => {
  cache = undefined
  await fileJsonStore({ path: SESSION_CACHE_PATH })
    .clear()
    .catch(() => undefined)
}
