'use client'

import { useEffect, useState } from 'react'

import { versionLine, webBuild } from '@/lib/build-info'

import { useIsDesktop } from './use-is-desktop'
import { desktopVersion } from './version-wire'

export function useVersionLine(): string | null {
  const isDesktop = useIsDesktop()
  const [macVersion, setMacVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!isDesktop) return undefined
    let current = true
    void desktopVersion().then((info) => {
      if (current) setMacVersion(info?.version ?? null)
    })
    return () => {
      current = false
    }
  }, [isDesktop])

  return versionLine({ web: webBuild(), desktopVersion: macVersion })
}
