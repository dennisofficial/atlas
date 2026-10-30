'use client'

import { useSyncExternalStore } from 'react'

import { isDesktopHost } from './desktop-attributes'

const subscribe = () => () => undefined
const readHost = () => isDesktopHost(window)
const readServer = () => false

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, readHost, readServer)
}
