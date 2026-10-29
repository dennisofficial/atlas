'use client'

import { useEffect, useState } from 'react'

import type { PrStateWire } from '@dltech/atlas-wire/web'

import { subscribeApiPrStates } from './api-pr-states-source'
import { subscribePrStatesFromApi } from './threads-api'

const NONE: readonly PrStateWire[] = []

export function useApiPrStates(): readonly PrStateWire[] {
  const [states, setStates] = useState<readonly PrStateWire[]>(NONE)
  useEffect(
    () =>
      subscribeApiPrStates({
        subscribe: subscribePrStatesFromApi,
        onStates: setStates,
      }),
    [],
  )
  return states
}
