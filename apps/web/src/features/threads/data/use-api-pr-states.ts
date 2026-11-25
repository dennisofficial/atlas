'use client'

import { useEffect, useState } from 'react'

import type { PrStateWire } from '@dltech/atlas-wire/web'

import {
  subscribeApiPrStates,
  subscribePrStatesFromApi,
  type ApiPrStatesSubscribe,
} from './api-pr-states-source'

const NONE: readonly PrStateWire[] = []

export function useApiPrStates({
  subscribe = subscribePrStatesFromApi,
  enabled = true,
}: {
  subscribe?: ApiPrStatesSubscribe
  enabled?: boolean
} = {}): readonly PrStateWire[] {
  const [states, setStates] = useState<readonly PrStateWire[]>(NONE)
  useEffect(() => {
    setStates(NONE)
    if (!enabled) return
    return subscribeApiPrStates({ subscribe, onStates: setStates })
  }, [subscribe, enabled])
  return enabled ? states : NONE
}
