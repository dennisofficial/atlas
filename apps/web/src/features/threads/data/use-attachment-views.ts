import { useEffect, useMemo, useState } from 'react'

import { mediaHashOf, type Attachment } from '@dltech/atlas-core'
import type { MessageAttachment } from '@dltech/atlas-ui/ai/message-images'

import { attachmentViewsOf } from './attachment-views'
import { mediaUrls } from './media-urls'

const NO_ATTACHMENTS: readonly Attachment[] = Object.freeze([])

const hashesOf = (attachments: readonly Attachment[]): readonly string[] =>
  attachments.flatMap((attachment) => {
    const hash = mediaHashOf(attachment)
    return hash === null ? [] : [hash]
  })

export function useAttachmentViews(args: {
  sessionId: string | undefined
  attachments: readonly Attachment[] | undefined
}): readonly MessageAttachment[] {
  const { sessionId } = args
  const attachments = args.attachments ?? NO_ATTACHMENTS
  const hashes = hashesOf(attachments)
  const key = hashes.join(',')
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map())

  useEffect(() => {
    if (sessionId === undefined) return
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

  return useMemo(() => attachmentViewsOf({ attachments, urls }), [attachments, urls])
}
