export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
export const IMMUTABLE_CDN_CACHE_CONTROL = 's-maxage=31536000'
export const REVALIDATE_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=86400'
export const REVALIDATE_CDN_CACHE_CONTROL = 's-maxage=60'
export const NO_STORE_CACHE_CONTROL = 'no-store'

const HASHED_FILENAME = /-[0-9a-f]{8,}\.[^./]+$/

export type CacheHeaders = { 'Cache-Control': string; 'CDN-Cache-Control': string }

export function isHashedPath(path: string): boolean {
  return HASHED_FILENAME.test(path)
}

export function cacheHeadersOf({ path, status }: { path: string; status: number }): CacheHeaders {
  if (status !== 200) {
    return { 'Cache-Control': NO_STORE_CACHE_CONTROL, 'CDN-Cache-Control': NO_STORE_CACHE_CONTROL }
  }
  if (isHashedPath(path)) {
    return {
      'Cache-Control': IMMUTABLE_CACHE_CONTROL,
      'CDN-Cache-Control': IMMUTABLE_CDN_CACHE_CONTROL,
    }
  }
  return {
    'Cache-Control': REVALIDATE_CACHE_CONTROL,
    'CDN-Cache-Control': REVALIDATE_CDN_CACHE_CONTROL,
  }
}
