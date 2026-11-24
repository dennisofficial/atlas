import { useCallback, useEffect, useMemo, useState } from 'react'

import { isTeammateType, standingsOfCrew, type ECrewStanding } from '@dltech/atlas-core'
import { isSubagentWorking } from '@dltech/atlas-client/crew'
import type { CrewRow } from '@dltech/atlas-plugin-crew/client'

import { lastVisitOf, NO_VISITS, recordDeparture, type CrewVisits } from '../store/crew-visits'
import type { SidebarSubagent } from '../store/subagent-row'
import { crewMemberRowsOf, crewRowsetOf, crewSidebarRowsOf } from './crew-rows'

export enum ECrewEscape {
  Ignore = 'ignore',
  Back = 'back',
  Arm = 'arm',
  Stop = 'stop',
}

export const crewEscapeOf = (args: {
  viewing: string | null
  armed: string | null
  stoppable: boolean
}): ECrewEscape => {
  if (args.viewing === null) return ECrewEscape.Ignore
  if (!args.stoppable) return ECrewEscape.Back
  return args.armed === args.viewing ? ECrewEscape.Stop : ECrewEscape.Arm
}

export type CrewControl = {
  rows: readonly SidebarSubagent[]
  teammates: readonly SidebarSubagent[]
  standings: ReadonlyMap<string, ECrewStanding>
  viewing: string | null
  backLabel: string | null
  running: number
  count: number
  handleSelect: (agentId: string) => void
  handleCycle: () => boolean
  handleEscape: () => boolean
  selectable: (agentId: string) => boolean
}

export function useCrewNavigation(args: { crew: readonly CrewRow[]; sessionId: string }): {
  viewing: string | null
  setViewing: (agentId: string | null) => void
} {
  const [viewing, setViewing] = useState<string | null>(null)
  const [scopedTo, setScopedTo] = useState<string>(args.sessionId)

  if (scopedTo !== args.sessionId) {
    setScopedTo(args.sessionId)
    setViewing(null)
  }

  useEffect(() => {
    if (viewing === null) return
    if (args.crew.some((row) => row.agentId === viewing)) return
    setViewing(null)
  }, [args.crew, viewing])

  return { viewing, setViewing }
}

const useCrewVisits = (viewing: string | null): CrewVisits => {
  const [visits, setVisits] = useState<CrewVisits>(NO_VISITS)

  useEffect(() => {
    if (viewing === null) return

    return () => {
      setVisits((held) =>
        recordDeparture({ visits: held, leaving: viewing, at: new Date().toISOString() }),
      )
    }
  }, [viewing])

  return visits
}

export function useCrew(args: {
  crew: readonly CrewRow[]
  viewing: string | null
  setViewing: (agentId: string | null) => void
  now: number
  onOpenSession: (agentId: string) => void
  onStop: (agentId: string) => void
  onProblem: (reason: string) => void
}): CrewControl {
  const { crew, viewing, setViewing, now } = args
  const [armed, setArmed] = useState<string | null>(null)

  useEffect(() => {
    setArmed(null)
  }, [viewing])
  const visits = useCrewVisits(viewing)

  const rowset = useMemo(() => crewRowsetOf(crew), [crew])

  const lastViewedOf = useCallback(
    (agentId: string): string | null => lastVisitOf({ visits, id: agentId }),
    [visits],
  )

  const standings = useMemo(
    () => standingsOfCrew({ crew: crewMemberRowsOf({ rows: crew, lastViewedOf }), viewing }),
    [crew, lastViewedOf, viewing],
  )

  const rows = useMemo(
    () =>
      crewSidebarRowsOf({
        rows: rowset.subagents,
        now,
        viewing,
        shells: [],
        children: [],
      }),
    [now, rowset.subagents, viewing],
  )

  const teammates = useMemo(
    () =>
      crewSidebarRowsOf({
        rows: rowset.teammates,
        now,
        viewing,
        shells: [],
        children: [],
      }),
    [now, rowset.teammates, viewing],
  )

  const selectable = useCallback(
    (agentId: string): boolean => {
      const row = crew.find((one) => one.agentId === agentId)
      return row !== undefined && !isTeammateType(row.agentType)
    },
    [crew],
  )

  const handleSelect = useCallback(
    (agentId: string) => {
      if (selectable(agentId)) {
        setViewing(viewing === agentId ? null : agentId)
        return
      }

      if (crew.some((row) => row.agentId === agentId)) {
        args.onOpenSession(agentId)
        return
      }

      args.onProblem(`no agent ${agentId} in this session`)
    },
    [args, crew, selectable, setViewing, viewing],
  )

  const handleCycle = useCallback((): boolean => {
    const ring = rowset.subagents
    if (ring.length === 0) return false

    const at = viewing === null ? -1 : ring.findIndex((row) => row.agentId === viewing)
    const next = ring[at + 1]
    setViewing(next === undefined ? null : next.agentId)
    return true
  }, [rowset.subagents, setViewing, viewing])

  const handleEscape = useCallback((): boolean => {
    const stoppable = crew.some((row) => row.agentId === viewing && isSubagentWorking(row))
    switch (crewEscapeOf({ viewing, armed, stoppable })) {
      case ECrewEscape.Ignore:
        return false
      case ECrewEscape.Back:
        setViewing(null)
        return true
      case ECrewEscape.Arm:
        setArmed(viewing)
        args.onProblem(`esc again to stop ${viewing}`)
        return true
      case ECrewEscape.Stop:
        setArmed(null)
        if (viewing !== null) args.onStop(viewing)
        return true
    }
  }, [armed, args, crew, setViewing, viewing])

  const running = rows.filter(isSubagentWorking).length

  return useMemo(
    () => ({
      rows,
      teammates,
      standings,
      viewing,
      backLabel: viewing === null ? null : 'back to main agent',
      running,
      count: rows.length,
      handleSelect,
      handleCycle,
      handleEscape,
      selectable,
    }),
    [
      handleCycle,
      handleEscape,
      handleSelect,
      rows,
      running,
      selectable,
      standings,
      teammates,
      viewing,
    ],
  )
}
