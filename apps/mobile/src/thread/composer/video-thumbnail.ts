import { getThumbnailAsync } from 'expo-video-thumbnails'
import { useEffect, useState } from 'react'

import { isVideoMediaType } from './attachment-plan'

export const useVideoThumbnail = ({
  uri,
  mediaType,
}: {
  uri: string
  mediaType: string
}): string | null => {
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const video = isVideoMediaType(mediaType)

  useEffect(() => {
    if (!video) return
    let live = true
    getThumbnailAsync(uri, { time: 0 })
      .then((result) => {
        if (live) setThumbnail(result.uri)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [uri, video])

  return video ? thumbnail : null
}
