import { useEffect, useRef, useState } from 'react'

import { useAuth } from '../../auth/auth-provider'

export function useMediaUrls(args: {
  sessionId: string | undefined
  hashes: readonly string[]
}): ReadonlyMap<string, string> {
  const { api } = useAuth()
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map())
  const requested = useRef(new Set<string>())
  const key = args.hashes.join('|')

  useEffect(() => {
    if (api === undefined || args.sessionId === undefined) return undefined
    const sessionId = args.sessionId
    let cancelled = false
    for (const hash of args.hashes) {
      if (requested.current.has(hash)) continue
      requested.current.add(hash)
      api.media.url
        .query({ sessionId, hash })
        .then((reply) => {
          if (cancelled) return
          setUrls((previous) => new Map(previous).set(hash, reply.url))
        })
        .catch(() => requested.current.delete(hash))
    }
    return () => {
      cancelled = true
    }
  }, [api, args.sessionId, key])

  return urls
}
