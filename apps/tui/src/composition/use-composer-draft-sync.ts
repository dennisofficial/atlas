import { useEffect, useMemo, useRef, type RefObject } from 'react'

import { composerDraftSyncFor, type ComposerDraftApi } from '@dltech/atlas-harness'

import type { DraftTokens } from '../ui/hooks/use-draft-tokens'

export function useComposerDraftSync(args: {
  cloud: { composerDraftApi: () => ComposerDraftApi | null }
  scope: string | null
  value: string
  editor: RefObject<{ plainText: string } | null>
  tokens: Pick<DraftTokens, 'restore'>
}): void {
  const { cloud, scope, value } = args
  const sync = useMemo(() => composerDraftSyncFor({ cloud, scope }), [cloud, scope])

  const latest = useRef(args)
  latest.current = args

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
