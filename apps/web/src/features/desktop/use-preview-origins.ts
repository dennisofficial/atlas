'use client'

import { useEffect, useState } from 'react'

import { postPreviewOrigins, previewOriginsOf } from './preview-origins'
import { useIsDesktop } from './use-is-desktop'

export function usePreviewOrigins(urls: readonly string[]): boolean {
  const desktop = useIsDesktop()
  const key = previewOriginsOf(urls).join('\n')
  const [allowedKey, setAllowedKey] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!desktop) return
    let current = true
    void postPreviewOrigins(key === '' ? [] : key.split('\n')).then(() => {
      if (current) setAllowedKey(key)
    })
    return () => {
      current = false
    }
  }, [desktop, key])

  useEffect(() => {
    if (!desktop) return
    return () => void postPreviewOrigins([])
  }, [desktop])

  return !desktop || allowedKey === key
}
