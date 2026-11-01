'use client'

import { createContext, useContext, type ReactNode } from 'react'

import type { PrObservationRegistry } from '@/features/threads/data/pr-observation-registry'
import type { PrObservation } from '@/features/threads/data/pr-observation-targets'
import { usePrObservationRef } from '@/features/threads/data/use-pr-observation'

const PrObservationsContext = createContext<PrObservationRegistry | null>(null)

export function SidebarPrObservationsProvider({
  registry,
  children,
}: {
  registry: PrObservationRegistry
  children: ReactNode
}) {
  return (
    <PrObservationsContext.Provider value={registry}>{children}</PrObservationsContext.Provider>
  )
}

export function useSidebarPrObservation(targets: readonly PrObservation[]) {
  const registry = useContext(PrObservationsContext)
  const ref = usePrObservationRef({ registry, targets })
  return registry === null ? undefined : ref
}
