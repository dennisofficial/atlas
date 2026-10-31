'use client'

import { useEffect, useState } from 'react'

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

export function useDesktop(): Desktop {
  const [found, setFound] = useState<DesktopCapabilities | null | undefined>(() => {
    if (typeof window === 'undefined') return undefined
    if (!isDesktopHost(window)) return null
    return undefined
  })

  useEffect(() => {
    if (found !== undefined) return undefined
    let current = true
    void desktopCapabilities().then((next) => {
      if (current) setFound(next)
    })
    return () => {
      current = false
    }
  }, [found])

  if (found === undefined) return PENDING
  if (found === null) return ABSENT
  return {
    ready: true,
    present: true,
    docker: found.docker,
    reason: found.reason,
  }
}
