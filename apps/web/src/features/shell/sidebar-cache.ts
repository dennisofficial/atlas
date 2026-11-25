import type { SessionSummary } from '@dltech/atlas-protocol'

export const SESSIONS_CACHE_KEY = 'atlas:sidebar-v2-sessions'
const SESSIONS_CACHE_VERSION = 1

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isSessionSummary = (value: unknown): value is SessionSummary =>
  isRecord(value) &&
  typeof value.sessionId === 'string' &&
  value.sessionId.length > 0 &&
  typeof value.createdAt === 'string' &&
  typeof value.updatedAt === 'string'

export function readSessionsCache(): SessionSummary[] | undefined {
  try {
    const raw = window.localStorage.getItem(SESSIONS_CACHE_KEY)
    if (raw === null) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.v !== SESSIONS_CACHE_VERSION) return undefined
    if (!Array.isArray(parsed.sessions) || !parsed.sessions.every(isSessionSummary)) {
      return undefined
    }
    return parsed.sessions
  } catch {
    return undefined
  }
}

export function writeSessionsCache(sessions: readonly SessionSummary[]): void {
  try {
    window.localStorage.setItem(
      SESSIONS_CACHE_KEY,
      JSON.stringify({ v: SESSIONS_CACHE_VERSION, sessions }),
    )
  } catch {}
}
