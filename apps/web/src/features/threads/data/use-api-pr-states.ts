'use client'

import { useEffect, useRef, useState } from 'react'

import type { PrStateWire } from '@dltech/atlas-wire/web'

import {
  subscribeApiPrStates,
  type ApiPrStatesSubscribe,
  type ApiPrStatesSubscription,
} from './api-pr-states-source'
import { notifyPrObservationStatus } from './pr-observation-status'
import { prObservationRegistrationKeyOf, type PrObservation } from './pr-observation-targets'
import { subscribePrStatesFromApi } from './threads-api'

const NONE: readonly PrStateWire[] = []
const NO_OBSERVATIONS: readonly PrObservation[] = []

export function useApiPrStates({
  subscribe = subscribePrStatesFromApi,
  observe = NO_OBSERVATIONS,
  enabled = true,
}: {
  subscribe?: ApiPrStatesSubscribe
  observe?: readonly PrObservation[]
  enabled?: boolean
} = {}): readonly PrStateWire[] {
  const [states, setStates] = useState<readonly PrStateWire[]>(NONE)
  const registration = useRef<ApiPrStatesSubscription | null>(null)
  const observationKey = prObservationRegistrationKeyOf(observe)
  useEffect(() => {
    setStates(NONE)
    if (!enabled) return
    const stop = subscribeApiPrStates({
      subscribe,
      observe,
      onStates: setStates,
      onObservationStatus: (status) => notifyPrObservationStatus({ source: subscribe, status }),
    })
    registration.current = stop
    return () => {
      registration.current = null
      stop()
    }
  }, [subscribe, enabled])
  useEffect(() => {
    registration.current?.setObservations(observe)
  }, [subscribe, enabled, observationKey])
  return enabled ? states : NONE
}
