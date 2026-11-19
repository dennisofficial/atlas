import type { ProjectThreads } from './thread-partition'
import type { V2SessionSummary } from './v2-rows'

export const SIDEBAR_CACHE_KEY = 'atlas:sidebar-threads'
export const V2_SESSIONS_CACHE_KEY = 'atlas:sidebar-v2-sessions'
const SIDEBAR_CACHE_VERSION = 1
const V2_SESSIONS_CACHE_VERSION = 1

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isProjectThreads = (value: unknown): value is ProjectThreads =>
  isRecord(value) && 'project' in value && Array.isArray(value.sessions)

const isV2SessionSummary = (value: unknown): value is V2SessionSummary =>
  isRecord(value) &&
  typeof value.sessionId === 'string' &&
  value.sessionId.length > 0 &&
  typeof value.createdAt === 'string' &&
  typeof value.updatedAt === 'string'

export function readSidebarCache(): ProjectThreads[] | undefined {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_CACHE_KEY)
    if (raw === null) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.v !== SIDEBAR_CACHE_VERSION) return undefined
    if (!Array.isArray(parsed.entries) || !parsed.entries.every(isProjectThreads)) return undefined
    return parsed.entries
  } catch {
    return undefined
  }
}

export function writeSidebarCache(entries: readonly ProjectThreads[]): void {
  try {
    window.localStorage.setItem(
      SIDEBAR_CACHE_KEY,
      JSON.stringify({ v: SIDEBAR_CACHE_VERSION, entries }),
    )
  } catch {}
}

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
