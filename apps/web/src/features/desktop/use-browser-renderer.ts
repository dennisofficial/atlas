'use client'

import { useEffect, useState } from 'react'

import { desktopVersion, type DesktopVersion } from './version-wire'

export type BrowserRenderer = 'cef' | 'native'

export function browserRendererOf(info: DesktopVersion | null): BrowserRenderer {
  return info?.chromium === true ? 'cef' : 'native'
}

export function useBrowserRenderer(): BrowserRenderer | null {
  const [renderer, setRenderer] = useState<BrowserRenderer | null>(null)

  useEffect(() => {
    let current = true
    void desktopVersion().then((info) => {
      if (current) setRenderer(browserRendererOf(info))
    })
    return () => {
      current = false
    }
  }, [])

  return renderer
}
