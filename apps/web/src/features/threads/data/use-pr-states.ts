'use client'

import { useEffect, useState } from 'react'

import type { PrStateWire } from '@dltech/atlas-wire/web'

import { subscribePrStates, type PrStatesChannel } from './pr-states-source'

const NONE: readonly PrStateWire[] = []

export function usePrStates(channel: PrStatesChannel | null): readonly PrStateWire[] {
  const [states, setStates] = useState<readonly PrStateWire[]>(NONE)

  useEffect(() => {
    if (channel === null) {
      setStates(NONE)
      return
    }
    return subscribePrStates({ channel, onStates: setStates })
  }, [channel])

  return states
}
