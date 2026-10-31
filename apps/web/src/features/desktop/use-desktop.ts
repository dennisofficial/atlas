'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

import { isDesktopHost } from './desktop-attributes'
import { desktopCapabilities, type DesktopCapabilities } from './desktop-wire'

export type Desktop = {
  ready: boolean
  present: boolean
  docker: boolean
  reason: string | undefined
}

const PENDING: Desktop = {
  ready: false,
  present: false,
  docker: false,
  reason: undefined,
}
const ABSENT: Desktop = {
  ready: true,
  present: false,
  docker: false,
  reason: undefined,
}

const subscribeToHost = () => () => undefined
const readHost = () => isDesktopHost(window)
const readServerHost = () => null

export function useDesktop(): Desktop {
  const host = useSyncExternalStore(subscribeToHost, readHost, readServerHost)
  const [found, setFound] = useState<DesktopCapabilities | null | undefined>(undefined)

  useEffect(() => {
    if (host !== true || found !== undefined) return undefined
    let current = true
    void desktopCapabilities().then((next) => {
      if (current) setFound(next)
    })
    return () => {
      current = false
    }
  }, [host, found])

  if (host === null) return PENDING
  if (!host) return ABSENT
  if (found === undefined) return PENDING
  if (found === null) {
    return { ready: true, present: true, docker: false, reason: 'This Mac host is unavailable' }
  }
  return {
    ready: true,
    present: true,
    docker: found.docker,
    reason: found.reason,
  }
}
