'use client'

import { useEffect, useState } from 'react'

import type { PrStateWire } from '@dltech/atlas-wire/web'

import { subscribeApiPrStates, type ApiPrStatesSubscribe } from './api-pr-states-source'
import { subscribePrStatesFromApi } from './threads-api'

const NONE: readonly PrStateWire[] = []

export function useApiPrStates({
  subscribe = subscribePrStatesFromApi,
}: {
  subscribe?: ApiPrStatesSubscribe
} = {}): readonly PrStateWire[] {
  const [states, setStates] = useState<readonly PrStateWire[]>(NONE)
  useEffect(
    () =>
      subscribeApiPrStates({
        subscribe,
        onStates: setStates,
      }),
    [subscribe],
  )
  return states
}
