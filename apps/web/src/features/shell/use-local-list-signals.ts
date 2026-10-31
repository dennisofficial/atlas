'use client'

import { useEffect } from 'react'

import { isDesktopHost } from '@/features/desktop/desktop-attributes'

export function useLocalListSignals(args: {
  visible: boolean
  reload: () => void
  subscribe: (listener: () => void) => () => void
}): void {
  const { visible, reload, subscribe } = args
  useEffect(() => {
    if (!visible || !isDesktopHost(window)) return undefined
    let active = true
    const unsubscribe = subscribe(() => {
      if (active) reload()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [visible, reload, subscribe])
}
