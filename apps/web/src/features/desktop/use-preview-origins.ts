'use client'

import { useEffect, useState } from 'react'

import { postPreviewOrigins, previewOriginsOf } from './preview-origins'
import { useIsDesktop } from './use-is-desktop'

export enum EPreviewGate {
  Ready = 'ready',
  Waiting = 'waiting',
  Failed = 'failed',
}

export const PREVIEW_RETRY_DELAY_MS = 1000

type Settled = { key: string; gate: EPreviewGate.Ready | EPreviewGate.Failed }

export function usePreviewOrigins(urls: readonly string[]): EPreviewGate {
  const desktop = useIsDesktop()
  const key = previewOriginsOf(urls).join('\n')
  const [settled, setSettled] = useState<Settled | undefined>(undefined)

  useEffect(() => {
    if (!desktop) return
    let current = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const origins = key === '' ? [] : key.split('\n')
    const settle = (gate: Settled['gate']) => {
      if (current) setSettled({ key, gate })
    }
    const handleRetry = () => {
      void postPreviewOrigins(origins).then((ok) =>
        settle(ok ? EPreviewGate.Ready : EPreviewGate.Failed),
      )
    }
    void postPreviewOrigins(origins).then((ok) => {
      if (!current) return
      if (ok) return settle(EPreviewGate.Ready)
      retryTimer = setTimeout(handleRetry, PREVIEW_RETRY_DELAY_MS)
    })
    return () => {
      current = false
      clearTimeout(retryTimer)
    }
  }, [desktop, key])

  useEffect(() => {
    if (!desktop) return
    return () => void postPreviewOrigins([])
  }, [desktop])

  if (!desktop) return EPreviewGate.Ready
  return settled?.key === key ? settled.gate : EPreviewGate.Waiting
}
