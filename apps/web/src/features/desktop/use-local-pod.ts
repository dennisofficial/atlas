'use client'

import { useEffect, useState } from 'react'

import { getLocalThread } from './local-thread-wire'
import type { Desktop } from './use-desktop'

export enum EThreadHome {
  Loading = 'loading',
  Cloud = 'cloud',
  ThisMac = 'this-mac',
}

export type ThreadHome = { home: EThreadHome; error: Error | null }

export function useThreadHome(args: { threadId: string; desktop: Desktop }): ThreadHome {
  const { threadId, desktop } = args
  const [found, setFound] = useState<(ThreadHome & { threadId: string }) | null>(null)

  useEffect(() => {
    if (!desktop.present) return undefined
    let current = true
    getLocalThread(threadId).then(
      (pod) => {
        if (!current) return
        setFound({
          threadId,
          home: pod === null ? EThreadHome.Cloud : EThreadHome.ThisMac,
          error: null,
        })
      },
      (failure: unknown) => {
        if (!current) return
        setFound({
          threadId,
          home: EThreadHome.Loading,
          error: failure instanceof Error ? failure : new Error(String(failure)),
        })
      },
    )
    return () => {
      current = false
    }
  }, [threadId, desktop.present])

  if (!desktop.ready) return { home: EThreadHome.Loading, error: null }
  if (!desktop.present) return { home: EThreadHome.Cloud, error: null }
  if (found?.threadId !== threadId) return { home: EThreadHome.Loading, error: null }
  return { home: found.home, error: found.error }
}
