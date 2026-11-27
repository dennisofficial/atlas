import { createDraftSync, type DraftContent, type DraftSync } from '@dltech/atlas-client/session'
import type { Attachment } from '@dltech/atlas-core'
import { useCallback, useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import { useAuth } from '../../auth/auth-provider'

export function useComposerDraft(args: {
  sessionId: string | null | undefined
  text: string
  attachments: readonly Attachment[]
  onRestore: (draft: DraftContent) => void
}): { handleSent: (text: string) => void } {
  const { sessionId, text, attachments } = args
  const { api } = useAuth()
  const syncRef = useRef<DraftSync | null>(null)
  const onRestoreRef = useRef(args.onRestore)
  useEffect(() => {
    onRestoreRef.current = args.onRestore
  })

  useEffect(() => {
    if (sessionId === undefined || api === undefined) return
    const sync = createDraftSync({
      put: (content) =>
        api.sessionDrafts.put.mutate({
          sessionId,
          text: content.text,
          attachments: [...content.attachments],
        }),
      clear: () => api.sessionDrafts.clear.mutate({ sessionId }),
    })
    syncRef.current = sync
    api.sessionDrafts.get
      .query({ sessionId })
      .then(({ draft }) => {
        const restored = sync.loaded(draft)
        if (restored === null) return
        onRestoreRef.current(restored)
      })
      .catch(() => sync.loaded(null))
    return () => {
      sync.flush()
      sync.dispose()
      syncRef.current = null
    }
  }, [api, sessionId])

  useEffect(() => {
    syncRef.current?.change({ text, attachments })
  }, [attachments, text])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') return
      syncRef.current?.flush()
    })
    return () => subscription.remove()
  }, [])

  const handleSent = useCallback((sentText: string) => {
    syncRef.current?.handleSent(sentText)
  }, [])

  return { handleSent }
}
