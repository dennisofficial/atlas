'use client'

import { useLayoutEffect } from 'react'

import { applyDesktopAttributes } from './desktop-attributes'
import { useIsDesktop } from './use-is-desktop'

export function DesktopChrome() {
  const desktop = useIsDesktop()
  useLayoutEffect(() => {
    applyDesktopAttributes({ root: document.documentElement, host: window })
  }, [])
  return desktop ? <div aria-hidden="true" data-desktop-drag-strip /> : null
}
