import type { V2SessionSummary } from './v2-rows'

export const V2_SESSIONS_CACHE_KEY = 'atlas:sidebar-v2-sessions'
const V2_SESSIONS_CACHE_VERSION = 1

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isV2SessionSummary = (value: unknown): value is V2SessionSummary =>
  isRecord(value) &&
  typeof value.sessionId === 'string' &&
  value.sessionId.length > 0 &&
  typeof value.createdAt === 'string' &&
  typeof value.updatedAt === 'string'

export function readV2SessionsCache(): V2SessionSummary[] | undefined {
  try {
    const raw = window.localStorage.getItem(V2_SESSIONS_CACHE_KEY)
    if (raw === null) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.v !== V2_SESSIONS_CACHE_VERSION) return undefined
    if (!Array.isArray(parsed.sessions) || !parsed.sessions.every(isV2SessionSummary)) {
      return undefined
    }
    return parsed.sessions
  } catch {
    return undefined
  }
}

export function writeV2SessionsCache(sessions: readonly V2SessionSummary[]): void {
  try {
    window.localStorage.setItem(
      V2_SESSIONS_CACHE_KEY,
      JSON.stringify({ v: V2_SESSIONS_CACHE_VERSION, sessions }),
    )
  } catch {}
}
