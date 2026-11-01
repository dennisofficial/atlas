'use client'

import { createContext, useContext, type ReactNode } from 'react'

import type { PrStateWire } from '@dltech/atlas-wire/web'

const SidebarPrStatesContext = createContext<readonly PrStateWire[]>([])

export function SidebarPrStatesProvider({
  states,
  children,
}: {
  states: readonly PrStateWire[]
  children: ReactNode
}) {
  return (
    <SidebarPrStatesContext.Provider value={states}>{children}</SidebarPrStatesContext.Provider>
  )
}

export function useSidebarPrStates(): readonly PrStateWire[] {
  return useContext(SidebarPrStatesContext)
}
