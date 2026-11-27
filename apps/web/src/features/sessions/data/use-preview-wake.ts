'use client'

import { useCallback, useEffect, useRef } from 'react'

import type { EPodPowerPhase } from '@dltech/atlas-core'
import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import {
  EPreviewWait,
  previewNeedsWake,
  previewReloadsOnWake,
  previewWaitOf,
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
  const wake = useCallback(() => requestWake(sessionId), [sessionId])
  const { wakePod } = usePodWake({ sessionId, live: wait === EPreviewWait.Awake, wake })
  const before = useRef(wait)

  useEffect(() => {
    const reload = previewReloadsOnWake({ before: before.current, now: wait })
    before.current = wait
    if (!reload) return
    updatePreviewBrowser({
      threadId: sessionId,
      change: ({ state }) => reloadedPreviews({ state, ports: [...ports] }),
    })
  }, [wait, sessionId, ports])

  return useCallback(
    (url: string) => {
      if (previewNeedsWake(wait)) wakePod()
      open(url)
    },
    [wait, open, wakePod],
  )
}
