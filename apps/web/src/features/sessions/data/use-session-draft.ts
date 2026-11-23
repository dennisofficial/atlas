import { useCallback, useEffect, useRef } from 'react'

import type { Attachment } from '@dltech/atlas-core'
import { createDraftSync, type DraftContent, type DraftSync } from '@dltech/atlas-client/session'

import { sessionDraftsApi, type SessionDraftsApi } from './session-drafts-api'

export function useSessionDraft(args: {
  sessionId: string | null
  text: string
  attachments: readonly Attachment[]
  onRestore: (draft: DraftContent) => void
  api?: SessionDraftsApi
}) {
  const { sessionId, text, attachments } = args
  const api = args.api ?? sessionDraftsApi
  const syncRef = useRef<DraftSync | null>(null)
  const onRestoreRef = useRef(args.onRestore)
  useEffect(() => {
    onRestoreRef.current = args.onRestore
  })

  useEffect(() => {
    const sync = createDraftSync({
      put: (content) => api.put({ sessionId, content }),
      clear: () => api.clear(sessionId),
    })
    syncRef.current = sync
    api
      .get(sessionId)
      .then((stored) => {
        const restored = sync.loaded(stored)
        if (restored !== null) onRestoreRef.current(restored)
      })
      .catch(() => sync.loaded(null))
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') sync.flush()
    }
    const handlePageHide = () => sync.flush()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
      sync.flush()
      sync.dispose()
      syncRef.current = null
    }
  }, [sessionId, api])

  useEffect(() => {
    syncRef.current?.change({ text, attachments })
  }, [text, attachments])

  const handleSent = useCallback((sentText: string) => syncRef.current?.handleSent(sentText), [])
  return { handleSent }
}
