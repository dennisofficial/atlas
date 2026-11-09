import type { V2Event } from '@dltech/atlas-core'
import {
  evictionsFrom,
  SESSION_CACHE_RECORD_VERSION,
  type CachedWindow,
  type SessionCache,
  windowFromRecord,
} from '@dltech/atlas-client/stream'
import type { z } from 'zod'

import type { JsonStore } from '../../storage/json-store'

const fileNameOf = (sessionId: string): string => `${encodeURIComponent(sessionId)}.json`

export const createStoredSessionCache = (args: {
  store: JsonStore
  now: () => number
  eventSchema?: z.ZodType<V2Event> | undefined
}): SessionCache => {
  const { store, now } = args
  return {
    load: (sessionId) =>
      store
        .read(fileNameOf(sessionId))
        .then((value) => windowFromRecord({ value, eventSchema: args.eventSchema }))
        .catch(() => undefined),
    save: async ({ sessionId, window }) => {
      const record: CachedWindow = { version: SESSION_CACHE_RECORD_VERSION, savedAt: now(), window }
      await store.write(fileNameOf(sessionId), record).catch(() => undefined)
      const entries = await store.list().catch(() => [])
      const stale = evictionsFrom({
        entries: entries.map((entry) => ({ key: entry.name, savedAt: entry.modifiedAt })),
      })
      await Promise.all(stale.map((name) => store.remove(name).catch(() => undefined)))
    },
  }
}
