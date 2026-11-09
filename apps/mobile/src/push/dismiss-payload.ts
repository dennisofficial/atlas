import { DISMISS_THREAD_DATA_KEY } from '@dltech/atlas-wire/web'

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined

const threadIdIn = (value: unknown): string | undefined => {
  const threadId = recordOf(value)?.[DISMISS_THREAD_DATA_KEY]
  return typeof threadId === 'string' && threadId.length > 0 ? threadId : undefined
}

export const dismissThreadIdOf = (payload: unknown): string | undefined => {
  const data = recordOf(payload)
  const direct = threadIdIn(data)
  if (direct !== undefined) return direct
  const raw = data?.dataString
  if (typeof raw !== 'string') return undefined
  try {
    return threadIdIn(JSON.parse(raw))
  } catch {
    return undefined
  }
}
