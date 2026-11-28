'use client'

import { useCallback, useEffect, useRef } from 'react'

import type { EPodPowerPhase } from '@dltech/atlas-core'
import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import {
  EPreviewShift,
  EPreviewWait,
  previewNeedsWake,
  previewShiftOf,
  previewWaitOf,
  previewsShifted,
} from '@/features/threads/data/preview-browser/preview-wake'
import { updatePreviewBrowser } from '@/features/threads/data/preview-browser/use-preview-browser'
import { changeRegistry, withWait } from '@/features/threads/panel/preview/frame-registry'
import { api, cloudCall } from '@/lib/api-client'

import { usePodWake } from './use-pod-wake'
import { usePreviewWakeTracking } from './use-preview-wake-tracking'

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
  const before = useRef<EPreviewWait | undefined>(undefined)
  const trackOpen = usePreviewWakeTracking({ sessionId, power, wait })

  useEffect(() => {
    changeRegistry((registry) => withWait({ registry, threadId: sessionId, wait }))
    return () =>
      changeRegistry((registry) => withWait({ registry, threadId: sessionId, wait: undefined }))
  }, [sessionId, wait])

  useEffect(() => {
    const shift = previewShiftOf({ before: before.current, now: wait })
    before.current = wait
    if (shift === EPreviewShift.None) return
    updatePreviewBrowser({
      threadId: sessionId,
      change: ({ state }) => previewsShifted({ state, ports: [...ports], shift }),
    })
  }, [wait, sessionId, ports])

  return useCallback(
    (url: string) => {
      trackOpen(url)
      if (previewNeedsWake(wait)) wakePod()
      open(url)
    },
    [wait, open, wakePod, trackOpen],
  )
}
