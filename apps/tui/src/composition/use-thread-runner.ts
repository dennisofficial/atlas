import { useEffect, useState } from 'react'

import { toThreadId, type ERunner } from '@dltech/atlas-core'

import type { AtlasApp } from './compose'

export function useThreadRunner(args: {
  app: Pick<AtlasApp, 'threads'>
  threadId: string | undefined
  refreshKey?: unknown
}): ERunner | undefined {
  const { app, threadId, refreshKey } = args
  const [runner, setRunner] = useState<ERunner | undefined>(undefined)

  useEffect(() => {
    if (threadId === undefined) {
      setRunner(undefined)
      return
    }
    let live = true
    void app.threads
      .find({ threadId: toThreadId(threadId) })
      .catch(() => undefined)
      .then((found) => {
        if (live) setRunner((held) => (held === found?.runner ? held : found?.runner))
      })
    return () => {
      live = false
    }
  }, [app, threadId, refreshKey])

  return runner
}
