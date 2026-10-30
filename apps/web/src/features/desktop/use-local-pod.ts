'use client'

import { useEffect, useState } from 'react'

import { getLocalPod } from './desktop-wire'
import type { Desktop } from './use-desktop'

export enum EThreadHome {
  Loading = 'loading',
  Cloud = 'cloud',
  ThisMac = 'this-mac',
}

export function useThreadHome(args: { threadId: string; desktop: Desktop }): EThreadHome {
  const { threadId, desktop } = args
  const [found, setFound] = useState<{
    threadId: string
    home: EThreadHome
  } | null>(null)

  useEffect(() => {
    if (!desktop.present) return undefined
    let current = true
    getLocalPod(threadId).then(
      (pod) => {
        if (current)
          setFound({
            threadId,
            home: pod === null ? EThreadHome.Cloud : EThreadHome.ThisMac,
          })
      },
      () => {
        if (current) setFound({ threadId, home: EThreadHome.Cloud })
      },
    )
    return () => {
      current = false
    }
  }, [threadId, desktop.present])

  if (!desktop.ready) return EThreadHome.Loading
  if (!desktop.present) return EThreadHome.Cloud
  return found?.threadId === threadId ? found.home : EThreadHome.Loading
}
