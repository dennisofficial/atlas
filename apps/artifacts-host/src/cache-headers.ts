export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
export const NO_CACHE_CACHE_CONTROL = 'no-cache'
export const NO_STORE_CACHE_CONTROL = 'no-store'

const HASHED_FILENAME = /-[0-9a-f]{8,}\.[^./]+$/

export type CacheHeaders = { 'Cache-Control': string }

export function isHashedPath(path: string): boolean {
  return HASHED_FILENAME.test(path)
}

export function cacheHeadersOf({ path, status }: { path: string; status: number }): CacheHeaders {
  if (status !== 200) return { 'Cache-Control': NO_STORE_CACHE_CONTROL }
  return { 'Cache-Control': isHashedPath(path) ? IMMUTABLE_CACHE_CONTROL : NO_CACHE_CACHE_CONTROL }
}
