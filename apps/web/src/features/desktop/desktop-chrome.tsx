'use client'

import { useEffect, useLayoutEffect } from 'react'

import { applyDesktopAttributes } from './desktop-attributes'
import { DESKTOP_DRAG_ATTRIBUTE, DESKTOP_DRAG_CSS } from './desktop-drag-css'
import { handleDocumentDoubleClick, postTitlebarDoubleClick } from './titlebar-double-click'
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
  useEffect(() => {
    if (!desktop) return
    const handleDoubleClick = (event: MouseEvent) =>
      handleDocumentDoubleClick({ event, post: postTitlebarDoubleClick })
    document.addEventListener('dblclick', handleDoubleClick)
    return () => document.removeEventListener('dblclick', handleDoubleClick)
  }, [desktop])
  return desktop ? <div aria-hidden="true" data-desktop-drag-strip /> : null
}
