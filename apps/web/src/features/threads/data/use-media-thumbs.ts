import { useEffect, useMemo, useState } from 'react'

import type { SaidMedia } from '@dltech/atlas-core'
import type { MessageImage } from '@dltech/atlas-ui/ai/message'

import { api, cloudCall } from '@/lib/api-client'

import { createMediaUrlCache } from './media-url-cache'

const NO_MEDIA: readonly SaidMedia[] = []
const NO_THUMBS: readonly MessageImage[] = []

export const mediaUrls = createMediaUrlCache({
  fetch: async (key) => (await cloudCall(api.media.url.query(key))).url,
})

export function useMediaThumbs(args: {
  sessionId: string | undefined
  media: readonly SaidMedia[] | undefined
}): readonly MessageImage[] {
  const { sessionId } = args
  const media = args.media ?? NO_MEDIA
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map())

  useEffect(() => {
    if (sessionId === undefined) return
    let cancelled = false
    for (const item of media) {
      const { hash } = item.media
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
  }, [sessionId, media])

  return useMemo(() => {
    if (sessionId === undefined || media.length === 0) return NO_THUMBS
    return media.flatMap((item, index) => {
      const src = urls.get(item.media.hash)
      if (src === undefined) return []
      return [{ id: `${sessionId}#media-${index}`, src, alt: item.source ?? 'image' }]
    })
  }, [sessionId, media, urls])
}
