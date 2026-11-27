'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { EPodPowerPhase } from '@dltech/atlas-core'
import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import {
  EPreviewWait,
  previewNeedsWake,
  previewOpensOnWake,
  previewWaitOf,
  previewWaitsForPod,
  reloadedPreviews,
} from '@/features/threads/data/preview-browser/preview-wake'
import { updatePreviewBrowser } from '@/features/threads/data/preview-browser/use-preview-browser'
import { api, cloudCall } from '@/lib/api-client'

import { usePodWake } from './use-pod-wake'

const requestWake = (sessionId: string): Promise<void> =>
  cloudCall(api.sessions.wakePod.mutate({ sessionId })).then(() => undefined)

export function usePreviewWake(args: {
  sessionId: string
  power: EPodPowerPhase | undefined
  ports: readonly PreviewPort[]
  open: (url: string) => void
}): (url: string) => void {
  const { sessionId, power, ports, open } = args
  const wait = previewWaitOf(power)
  const [pending, setPending] = useState<string | undefined>(undefined)
  const previous = useRef(wait)
  const wake = useCallback(() => requestWake(sessionId), [sessionId])
  const { wakePod } = usePodWake({ sessionId, live: wait === EPreviewWait.Awake, wake })

  useEffect(() => {
    const held = previous.current
    previous.current = wait
    if (!previewOpensOnWake({ previous: held, current: wait })) return
    updatePreviewBrowser({
      threadId: sessionId,
      change: ({ state }) => reloadedPreviews({ state, ports }),
    })
    if (pending === undefined) return
    setPending(undefined)
    open(pending)
  }, [wait, pending, sessionId, ports, open])

  return useCallback(
    (url: string) => {
      if (!previewWaitsForPod(wait)) {
        open(url)
        return
      }
      setPending(url)
      if (previewNeedsWake(wait)) wakePod()
    },
    [wait, open, wakePod],
  )
}
