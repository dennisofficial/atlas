import { NOTIFY_DATA_CLEAR_SESSION_KEY } from '@dltech/atlas-notifications'
import { z } from 'zod'

const clearSchema = z.object({ [NOTIFY_DATA_CLEAR_SESSION_KEY]: z.string().min(1) })

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined

const clearedSessionIn = (value: unknown): string | undefined => {
  const parsed = clearSchema.safeParse(value)
  return parsed.success ? parsed.data[NOTIFY_DATA_CLEAR_SESSION_KEY] : undefined
}

export const clearSessionIdOf = (payload: unknown): string | undefined => {
  const data = recordOf(payload)
  const direct = clearedSessionIn(data)
  if (direct !== undefined) return direct
  const raw = data?.['dataString']
  if (typeof raw !== 'string') return undefined
  try {
    return clearedSessionIn(JSON.parse(raw))
  } catch {
    return undefined
  }
}
