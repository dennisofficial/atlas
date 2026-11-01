import { useCallback, useEffect, useRef } from 'react'

import type { SaidUpload } from '@dltech/atlas-core'

import { createDraftSync, type DraftContent, type DraftSync } from './composer-draft-sync'
import { clearDraft, fetchDraft, putDraft } from './composer-drafts-api'

export function useComposerDraft(args: {
  scope: string
  text: string
  uploads: readonly SaidUpload[]
  onRestore: (draft: DraftContent) => void
}) {
  const { scope, text, uploads } = args
  const syncRef = useRef<DraftSync | null>(null)
  const onRestoreRef = useRef(args.onRestore)
  useEffect(() => {
    onRestoreRef.current = args.onRestore
  })

  useEffect(() => {
    const sync = createDraftSync({ scope, put: putDraft, clear: clearDraft })
    syncRef.current = sync
    fetchDraft(scope)
      .then((stored) => {
        const restored = sync.loaded(stored)
        if (restored !== null) onRestoreRef.current(restored)
      })
      .catch(() => sync.loaded(null))
    return () => {
      sync.flush()
      sync.dispose()
      syncRef.current = null
    }
  }, [scope])

  useEffect(() => {
    syncRef.current?.change({ text, uploads })
  }, [text, uploads])

  const handleSent = useCallback((sentText: string) => syncRef.current?.handleSent(sentText), [])
  return { handleSent }
}
