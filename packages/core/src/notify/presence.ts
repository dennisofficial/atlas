import { z } from 'zod'

import { EClientSurface } from './surface'

export const PRESENCE_TTL_MS = 90_000

export const PRESENCE_REPORT_MS = 30_000

export type NotifyPresence = {
  surface: EClientSurface
  sessionId: string | null
  foreground: boolean
  at: string
}

export const notifyPresenceSchema = z.object({
  surface: z.enum(EClientSurface),
  sessionId: z.string().min(1).nullable(),
  foreground: z.boolean(),
  at: z.string().min(1),
})

export const presenceIsFresh = (args: { at: string; now: string }): boolean => {
  const at = Date.parse(args.at)
  const now = Date.parse(args.now)
  if (Number.isNaN(at) || Number.isNaN(now)) return false
  return now - at < PRESENCE_TTL_MS
}

const parsePresence = (raw: string): NotifyPresence | null => {
  const parsed = notifyPresenceSchema.safeParse(JSON.parse(raw))
  return parsed.success ? parsed.data : null
}

const readPresence = (raw: string): NotifyPresence | null => {
  try {
    return parsePresence(raw)
  } catch {
    return null
  }
}

export const notifyPresenceOf = (args: { fields: Record<string, string> }): NotifyPresence[] =>
  Object.values(args.fields).flatMap((raw) => {
    const presence = readPresence(raw)
    return presence === null ? [] : [presence]
  })
