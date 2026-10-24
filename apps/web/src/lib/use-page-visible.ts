'use client'

import { useSyncExternalStore } from 'react'

const subscribe = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

const isVisible = () => document.visibilityState !== 'hidden'

const visibleOnServer = () => true

export const usePageVisible = (): boolean =>
  useSyncExternalStore(subscribe, isVisible, visibleOnServer)
