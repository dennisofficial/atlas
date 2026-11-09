'use client'

import { useSyncExternalStore } from 'react'

import { hasNativeBrowser } from './desktop-attributes'

const subscribe = () => () => undefined
const readHost = () => hasNativeBrowser(window)
const readServer = () => false

export function useHasNativeBrowser(): boolean {
  return useSyncExternalStore(subscribe, readHost, readServer)
}
