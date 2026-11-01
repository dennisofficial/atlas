import type { ProjectThreads } from './thread-partition'

export const SIDEBAR_CACHE_KEY = 'atlas:sidebar-threads'
const SIDEBAR_CACHE_VERSION = 1

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isProjectThreads = (value: unknown): value is ProjectThreads =>
  isRecord(value) && 'project' in value && Array.isArray(value.sessions)

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
