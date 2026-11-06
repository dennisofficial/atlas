import { useEffect, useRef } from 'react'

import { DESKTOP_PREVIEW_CALLBACK_EVENT } from '@dltech/atlas-wire/web'

import { desktopPathOf } from '@/features/desktop/use-desktop-navigation'

import { openPreviewCallback } from '../../data/preview-browser/preview-callback'
import { updatePreviewBrowser } from '../../data/preview-browser/use-preview-browser'
import type { VisibleSlot } from './frame-registry'

export function usePreviewCallback(visible: VisibleSlot | undefined): void {
  const lastShown = useRef<VisibleSlot | undefined>(undefined)
  useEffect(() => {
    if (visible !== undefined) lastShown.current = visible
  }, [visible])
  useEffect(() => {
    const handleCallback = (event: Event) => {
      const path = desktopPathOf(event)
      const slot = lastShown.current
      if (path === null || slot === undefined) return
      updatePreviewBrowser({
        threadId: slot.threadId,
        change: ({ state }) => openPreviewCallback({ state, tabId: slot.tabId, path }),
      })
    }
    window.addEventListener(DESKTOP_PREVIEW_CALLBACK_EVENT, handleCallback)
    return () => window.removeEventListener(DESKTOP_PREVIEW_CALLBACK_EVENT, handleCallback)
  }, [])
}
