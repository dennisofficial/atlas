'use client'

import { useSyncExternalStore } from 'react'

import { isDesktopHost } from './desktop-attributes'

export type Desktop = {
  ready: boolean
  present: boolean
}

const PENDING: Desktop = { ready: false, present: false }
const ABSENT: Desktop = { ready: true, present: false }

const subscribeToHost = () => () => undefined
const readHost = () => isDesktopHost(window)
const readServerHost = () => null

export function useDesktop(): Desktop {
  const host = useSyncExternalStore(subscribeToHost, readHost, readServerHost)
  if (host === null) return PENDING
  return host ? { ready: true, present: true } : ABSENT
}
