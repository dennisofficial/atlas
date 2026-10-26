'use client'

import { useEffect, useState } from 'react'

import type { RosterWire } from '@dltech/atlas-wire/web'

import { subscribeRoster, type RosterChannel } from './roster-source'

export function useRoster(channel: RosterChannel | null): RosterWire | null {
  const [roster, setRoster] = useState<RosterWire | null>(null)

  useEffect(() => {
    if (channel === null) {
      setRoster(null)
      return
    }
    return subscribeRoster({ channel, onRoster: setRoster })
  }, [channel])

  return roster
}
