'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { EPodPowerPhase } from '@dltech/atlas-core'
import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import {
  EPreviewWait,
  previewNeedsWake,
  previewOpensOnReady,
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
  readyAt: string | undefined
  open: (url: string) => void
}): (url: string) => void {
  const { sessionId, power, ports, readyAt, open } = args
  const wait = previewWaitOf(power)
  const [pending, setPending] = useState<string | undefined>(undefined)
  const seenReady = useRef(readyAt)
  const wake = useCallback(() => requestWake(sessionId), [sessionId])
  const { wakePod } = usePodWake({ sessionId, live: wait === EPreviewWait.Awake, wake })

  useEffect(() => {
    if (!previewOpensOnReady({ seen: seenReady.current, now: readyAt })) return
    seenReady.current = readyAt
    updatePreviewBrowser({
      threadId: sessionId,
      change: ({ state }) =>
        reloadedPreviews({
          state,
          ports: [...ports],
          ...(pending === undefined ? {} : { except: pending }),
        }),
    })
    if (pending === undefined) return
    setPending(undefined)
    open(pending)
  }, [readyAt, pending, sessionId, ports, open])

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
