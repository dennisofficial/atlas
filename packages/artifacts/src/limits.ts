import type { ManifestEntry } from './manifest'

export const MAX_BYTES_PER_VERSION = 25 * 1024 * 1024

export const MAX_FILES_PER_VERSION = 2000

export const MAX_BYTES_PER_USER = 500 * 1024 * 1024

export function exceededBy(entries: readonly ManifestEntry[]): { reason: string } | null {
  if (entries.length > MAX_FILES_PER_VERSION) {
    return { reason: `files ${entries.length} exceeds ${MAX_FILES_PER_VERSION}` }
  }
  const bytes = entries.reduce((total, entry) => total + entry.size, 0)
  if (bytes > MAX_BYTES_PER_VERSION) {
    return { reason: `bytes ${bytes} exceeds ${MAX_BYTES_PER_VERSION}` }
  }
  return null
}
