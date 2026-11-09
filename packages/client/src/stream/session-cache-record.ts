import { v2EventSchema, type V2Event } from '@dltech/atlas-core'
import type { z } from 'zod'

import type { SessionWindow } from './session-window'

export const SESSION_CACHE_LIMIT = 20
export const SESSION_CACHE_RECORD_VERSION = 1

export type CachedWindow = { version: number; savedAt: number; window: SessionWindow }

type CachedWindowArgs = {
  value: unknown
  eventSchema?: z.ZodType<V2Event> | undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isCursor = (value: unknown): boolean =>
  value === undefined ||
  (isRecord(value) && typeof value.seq === 'number' && typeof value.hash === 'string')

const isSpan = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.createdAt === 'number' &&
  typeof value.fromSeq === 'number' &&
  typeof value.throughSeq === 'number' &&
  typeof value.keepSurvivors === 'boolean'

const isWindow = (value: unknown, eventSchema: z.ZodType<V2Event>): value is SessionWindow =>
  isRecord(value) &&
  Array.isArray(value.events) &&
  value.events.every((event) => eventSchema.safeParse(event).success) &&
  isRecord(value.visibility) &&
  Array.isArray(value.visibility.spans) &&
  value.visibility.spans.every(isSpan) &&
  isCursor(value.cursor)

export const isCachedWindow = (
  args: CachedWindowArgs,
): args is CachedWindowArgs & {
  value: CachedWindow
} => {
  const { value } = args
  return (
    isRecord(value) &&
    value.version === SESSION_CACHE_RECORD_VERSION &&
    typeof value.savedAt === 'number' &&
    isWindow(value.window, args.eventSchema ?? v2EventSchema)
  )
}

export const windowFromRecord = (args: CachedWindowArgs): SessionWindow | undefined =>
  isCachedWindow(args) ? args.value.window : undefined

export const savedAtOf = (value: unknown): number =>
  isRecord(value) && typeof value.savedAt === 'number' ? value.savedAt : 0

export const evictionsFrom = (args: {
  entries: readonly { key: string; savedAt: number }[]
  limit?: number | undefined
}): string[] => {
  const excess = args.entries.length - (args.limit ?? SESSION_CACHE_LIMIT)
  if (excess <= 0) return []
  return [...args.entries]
    .sort((a, b) => a.savedAt - b.savedAt)
    .slice(0, excess)
    .map((entry) => entry.key)
}
