import { createDraftSync, type DraftContent, type DraftSync } from '@dltech/atlas-client/session'
import type { Attachment } from '@dltech/atlas-core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import { draftContentOf } from './composer-draft-content'

export function useComposerDraft(args: {
  sessionId: string | null | undefined
  text: string
  attachments: readonly Attachment[]
  onRestore: (draft: DraftContent) => void
}): { handleSent: (text: string) => void } {
  const { sessionId, text, attachments } = args
  const { api } = useAuth()
  const syncRef = useRef<DraftSync | null>(null)
  const [carried, setCarried] = useState<readonly Attachment[]>([])
  const onRestoreRef = useRef(args.onRestore)
  useEffect(() => {
    onRestoreRef.current = args.onRestore
  })

  useEffect(() => {
    if (sessionId === undefined || api === undefined) return
    setCarried([])
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
        setCarried(restored.attachments)
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
    syncRef.current?.change(draftContentOf({ text, carried, attachments }))
  }, [attachments, carried, text])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') return
      syncRef.current?.flush()
    })
    return () => subscription.remove()
  }, [])

  const handleSent = useCallback((sentText: string) => {
    setCarried([])
    syncRef.current?.handleSent(sentText)
  }, [])

  return { handleSent }
}
