import { useEffect, useMemo, useRef, type RefObject } from 'react'

import type { DraftTokens } from '../ui/hooks/use-draft-tokens'
import { composerDraftOf } from './composer-draft'
import type { SessionApi } from './session-api'

export function useComposerDraft(args: {
  api: SessionApi
  scope: string | null
  value: string
  editor: RefObject<{ plainText: string } | null>
  tokens: Pick<DraftTokens, 'restore'>
}): void {
  const { api, scope, value } = args
  const latest = useRef(args)
  latest.current = args

  const sync = useMemo(
    () => (scope === null ? null : composerDraftOf({ api, scope })),
    [api, scope],
  )

  useEffect(() => {
    if (sync === null) return undefined

    let open = true
    void sync.load().then((text) => {
      if (!open || text === null) return
      const editor = latest.current.editor.current
      if (editor === null || editor.plainText.length > 0) return
      latest.current.tokens.restore({ text, images: [] })
    })

    return () => {
      open = false
      sync.dispose()
    }
  }, [sync])

  useEffect(() => {
    sync?.handleText(value)
  }, [sync, value])
}
