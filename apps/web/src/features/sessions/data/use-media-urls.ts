import { useEffect, useState } from 'react'

import { mediaUrls } from '@/features/threads/data/media-urls'

export function useMediaUrls(args: {
  sessionId: string
  hashes: readonly string[]
}): ReadonlyMap<string, string> {
  const { sessionId } = args
  const key = args.hashes.join(',')
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map())

  useEffect(() => {
    let cancelled = false
    for (const hash of key.length === 0 ? [] : key.split(',')) {
      mediaUrls
        .urlOf({ sessionId, hash })
        .then((url) => {
          if (!cancelled) setUrls((previous) => new Map(previous).set(hash, url))
        })
        .catch(() => undefined)
    }
    return () => {
      cancelled = true
    }
  }, [sessionId, key])

  return urls
}
