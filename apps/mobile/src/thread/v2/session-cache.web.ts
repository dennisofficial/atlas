import {
  browserSessionCache,
  clearBrowserSessionCache,
  memorySessionCache,
  type SessionCache,
} from '@dltech/atlas-client/stream'

import { v2EventSchema } from './registered-plugins'

const factory = (): IDBFactory | undefined =>
  typeof indexedDB === 'undefined' ? undefined : indexedDB

let cache: SessionCache | undefined

export const sessionCache = (): SessionCache => {
  if (cache !== undefined) return cache
  cache = factory() === undefined ? memorySessionCache() : browserSessionCache(v2EventSchema)
  return cache
}

export const clearSessionCache = async (): Promise<void> => {
  cache = undefined
  await clearBrowserSessionCache(factory())
}
