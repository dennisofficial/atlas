'use client'

import { useEffect, useState } from 'react'

import { paneAvailable } from './pane-client'

export enum EPaneMode {
  Probing = 'probing',
  InPage = 'in-page',
  Shell = 'shell',
}

export const paneModeOf = (available: boolean): EPaneMode =>
  available ? EPaneMode.Shell : EPaneMode.InPage

export function usePaneMode(): EPaneMode {
  const [mode, setMode] = useState(EPaneMode.Probing)

  useEffect(() => {
    let live = true
    void paneAvailable().then((available) => {
      if (live) setMode(paneModeOf(available))
    })
    return () => {
      live = false
    }
  }, [])

  return mode
}
