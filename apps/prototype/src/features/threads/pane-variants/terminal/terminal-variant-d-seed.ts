import { useEffect, useRef } from 'react'

import { ETerminalScenario, type TerminalScenarioState } from './terminal-scenario'

export const SEEDED_SHELLS = 6

export function useSeededShells(state: TerminalScenarioState) {
  const target = useRef(SEEDED_SHELLS)
  const { scenario, terminals, create, select } = state

  useEffect(() => {
    target.current = scenario === ETerminalScenario.Live ? SEEDED_SHELLS : 0
  }, [scenario])

  useEffect(() => {
    if (target.current === 0) return
    if (terminals.length < target.current) {
      create()
      return
    }
    target.current = 0
    const first = terminals[0]
    if (first) select(first.id)
  }, [terminals, create, select])
}
