'use client'

import { useLayoutEffect } from 'react'

import { applyDesktopAttributes } from './desktop-attributes'
import { DESKTOP_DRAG_ATTRIBUTE, DESKTOP_DRAG_CSS } from './desktop-drag-css'
import { useIsDesktop } from './use-is-desktop'

export function DesktopChrome() {
  const desktop = useIsDesktop()
  useLayoutEffect(() => {
    applyDesktopAttributes({ root: document.documentElement, host: window })
  }, [])
  useLayoutEffect(() => {
    if (!desktop) return
    const style = document.createElement('style')
    style.setAttribute(DESKTOP_DRAG_ATTRIBUTE, '')
    style.textContent = DESKTOP_DRAG_CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, [desktop])
  return desktop ? <div aria-hidden="true" data-desktop-drag-strip /> : null
}
