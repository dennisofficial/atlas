import type { Attachment } from '@dltech/atlas-core'
import { useEffect, useRef, useState } from 'react'

import { useAuth } from '../../auth/auth-provider'
import { fetchableOf } from '../attachment-views'

export function useAttachmentSources(args: {
  threadId: string | undefined
  attachments: readonly Attachment[]
}): ReadonlyMap<string, string> {
  const { api } = useAuth()
  const [sources, setSources] = useState<ReadonlyMap<string, string>>(new Map())
  const requested = useRef(new Set<string>())
  const key = fetchableOf(args.attachments)
    .map((entry) => entry.key)
    .join('|')

  useEffect(() => {
    if (api === undefined || args.threadId === undefined) return undefined
    let cancelled = false
    for (const entry of fetchableOf(args.attachments)) {
      if (requested.current.has(entry.key)) continue
      requested.current.add(entry.key)
      api.composerUploads.download
        .mutate({ threadId: args.threadId, pathname: entry.pathname })
        .then((reply) => {
          if (cancelled || !reply.found) return
          setSources((previous) => new Map(previous).set(entry.key, reply.downloadUrl))
        })
        .catch(() => requested.current.delete(entry.key))
    }
    return () => {
      cancelled = true
    }
  }, [api, args.threadId, key])

  return sources
}
