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

const INDEX = 'index'

const fileNameOf = (sessionId: string): string => `${encodeURIComponent(sessionId)}.json`

type SavedAt = Readonly<Record<string, number>>

const savedAtOf = (raw: unknown): SavedAt => {
  if (typeof raw !== 'object' || raw === null) return {}
  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
  )
}

export const createStoredSessionCache = (args: {
  store: JsonStore
  now: () => number
  eventSchema?: z.ZodType<V2Event> | undefined
}): SessionCache => {
  const { store, now } = args

  const evict = async (kept: SavedAt): Promise<void> => {
    const names = await store.keys().catch(() => [] as readonly string[])
    const entries = names
      .filter((name) => name !== INDEX)
      .map((name) => ({ key: name, savedAt: kept[name] ?? 0 }))
    const stale = evictionsFrom({ entries })
    if (stale.length === 0) return
    await Promise.all(stale.map((name) => store.remove(name).catch(() => undefined)))
    const remaining = Object.fromEntries(
      Object.entries(kept).filter(([name]) => !stale.includes(name)),
    )
    await store.write(INDEX, remaining).catch(() => undefined)
  }

  return {
    load: (sessionId) =>
      store
        .read(fileNameOf(sessionId))
        .then((value) => windowFromRecord({ value, eventSchema: args.eventSchema }))
        .catch(() => undefined),
    save: async ({ sessionId, window }) => {
      const name = fileNameOf(sessionId)
      const record: CachedWindow = { version: SESSION_CACHE_RECORD_VERSION, savedAt: now(), window }
      const written = await store.write(name, record).then(
        () => true,
        () => false,
      )
      if (!written) return
      const held = await store.read(INDEX).catch(() => undefined)
      await evict({ ...savedAtOf(held), [name]: record.savedAt })
    },
  }
}
