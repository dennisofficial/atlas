import type { Attachment } from '@dltech/atlas-core'
import { useEffect, useRef, useState } from 'react'

import { useAuth } from '../../auth/auth-provider'
import { fetchableOf } from '../attachment-views'

export function useAttachmentSources(args: {
  threadId: string | undefined
  sessionId: string | undefined
  attachments: readonly Attachment[]
}): ReadonlyMap<string, string> {
  const { api } = useAuth()
  const [sources, setSources] = useState<ReadonlyMap<string, string>>(new Map())
  const requested = useRef(new Set<string>())
  const key = fetchableOf(args.attachments)
    .map((entry) => entry.key)
    .join('|')

  useEffect(() => {
    if (api === undefined) return undefined
    let cancelled = false
    const keep = (entryKey: string, url: string) => {
      if (cancelled) return
      setSources((previous) => new Map(previous).set(entryKey, url))
    }
    const forget = (entryKey: string) => requested.current.delete(entryKey)
    for (const entry of fetchableOf(args.attachments)) {
      if (requested.current.has(entry.key)) continue
      if (entry.kind === 'upload') {
        if (args.threadId === undefined) continue
        const threadId = args.threadId
        requested.current.add(entry.key)
        api.composerUploads.download
          .mutate({ threadId, pathname: entry.pathname })
          .then((reply) => {
            if (!reply.found) return
            keep(entry.key, reply.downloadUrl)
          })
          .catch(() => forget(entry.key))
        continue
      }
      if (args.sessionId === undefined) continue
      const sessionId = args.sessionId
      requested.current.add(entry.key)
      api.media.url
        .query({ sessionId, hash: entry.hash })
        .then((reply) => keep(entry.key, reply.url))
        .catch(() => forget(entry.key))
    }
    return () => {
      cancelled = true
    }
  }, [api, args.threadId, args.sessionId, key])

  return sources
}
