'use client'

import { useLayoutEffect } from 'react'

import { applyDesktopAttributes } from './desktop-attributes'

export function DesktopChrome() {
  useLayoutEffect(() => {
    applyDesktopAttributes({ root: document.documentElement, host: window })
  }, [])
  return null
}
