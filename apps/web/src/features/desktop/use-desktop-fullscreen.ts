'use client'

import { useEffect } from 'react'

import { applyFullScreen, watchFullScreen } from './desktop-attributes'

export function useDesktopFullScreen({ enabled }: { enabled: boolean }): void {
  useEffect(() => {
    if (!enabled) return
    return watchFullScreen({
      host: window,
      onChange: (fullScreen) => applyFullScreen({ root: document.documentElement, fullScreen }),
    })
  }, [enabled])
}
