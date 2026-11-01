'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { createPrObservationRegistry, type PrObservationRegistry } from './pr-observation-registry'
import { prObservationRegistrationKeyOf, type PrObservation } from './pr-observation-targets'

const NONE: readonly PrObservation[] = []
const serverSnapshot = () => NONE

export function usePrObservationRegistry() {
  const registry = useMemo(createPrObservationRegistry, [])
  const observe = useSyncExternalStore(registry.subscribe, registry.snapshot, serverSnapshot)
  useEffect(() => () => registry.dispose(), [registry])
  return { registry, observe }
}

export function usePrObservationRef(args: {
  registry: PrObservationRegistry | null
  targets: readonly PrObservation[]
}) {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const registration = useRef<ReturnType<PrObservationRegistry['register']> | null>(null)
  const key = prObservationRegistrationKeyOf(args.targets)
  useEffect(() => {
    if (element === null || args.registry === null) return
    const entry = args.registry.register({ element, targets: args.targets })
    registration.current = entry
    return () => {
      registration.current = null
      entry.remove()
    }
  }, [element, args.registry])
  useEffect(() => {
    registration.current?.update(args.targets)
  }, [key])
  return setElement
}
