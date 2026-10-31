import { useCallback } from 'react'

import type { AtlasApp } from './compose'

export function useDriveRefusal(args: {
  app: AtlasApp
  extra: (() => string | null) | undefined
}): () => string | null {
  const { app, extra } = args
  const local = useCallback((): string | null => {
    if (app.sessionOwner.snapshot().bound) return null
    return 'the sandbox is still connecting — your message sends once the channel is open'
  }, [app.sessionOwner])
  return useCallback((): string | null => local() ?? extra?.() ?? null, [local, extra])
}
