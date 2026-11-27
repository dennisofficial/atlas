'use client'

import { useEffect, useState } from 'react'

import { Spinner } from '@dltech/atlas-ui/components/spinner'

import { EPreviewWait } from '../../data/preview-browser/preview-wake'

export const PREVIEW_WAKE_DELAY_MS = 400

export const previewWakeCopyOf = (wait: EPreviewWait): string =>
  wait === EPreviewWait.Awake ? 'Loading the preview…' : 'Waking the pod…'

export function PreviewWakeOverlay(props: {
  wait: EPreviewWait
  loading: boolean
  delayMs?: number
}) {
  const { wait, loading } = props
  const delayMs = props.delayMs ?? PREVIEW_WAKE_DELAY_MS
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!loading) {
      setShown(false)
      return undefined
    }
    const timer = setTimeout(() => setShown(true), delayMs)
    return () => clearTimeout(timer)
  }, [loading, delayMs])

  if (!loading || !shown) return null
  return (
    <div
      role="status"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center text-muted-foreground"
    >
      <Spinner aria-hidden />
      <p className="text-sm">{previewWakeCopyOf(wait)}</p>
    </div>
  )
}
