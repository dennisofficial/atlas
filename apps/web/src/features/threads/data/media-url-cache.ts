export const MEDIA_URL_TTL_MS = 50 * 60 * 1000

type Fetched = { promise: Promise<string>; at: number }

export function createMediaUrlCache(args: {
  fetch: (key: { sessionId: string; hash: string }) => Promise<string>
  now?: () => number
  ttlMs?: number
}) {
  const now = args.now ?? Date.now
  const ttlMs = args.ttlMs ?? MEDIA_URL_TTL_MS
  const entries = new Map<string, Fetched>()

  const urlOf = (key: { sessionId: string; hash: string }): Promise<string> => {
    const id = `${key.sessionId}:${key.hash}`
    const known = entries.get(id)
    if (known !== undefined && now() - known.at < ttlMs) return known.promise
    const promise = args.fetch(key)
    entries.set(id, { promise, at: now() })
    promise.catch(() => {
      if (entries.get(id)?.promise === promise) entries.delete(id)
    })
    return promise
  }

  return { urlOf }
}
