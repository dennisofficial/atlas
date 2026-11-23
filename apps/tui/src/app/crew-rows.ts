import { EAgentStatus, isTeammateType } from '@dltech/atlas-core'
import { crewActivityOf, subagentStateLabel } from '@dltech/atlas-client/crew'
import type { CrewMember } from '@dltech/atlas-core'
import type { CrewRow } from '@dltech/atlas-plugin-crew/client'

import { truncateCells } from '../ui/components/sidebar/cells'
import { oneLineOf, TITLE_CELLS } from '../store/sidebar-text'
import type { SidebarSubagent } from '../store/subagent-row'
import type { EShellStatus } from '@dltech/atlas-core'

export type CrewRowset = {
  subagents: readonly CrewRow[]
  teammates: readonly CrewRow[]
}

export const crewRowsetOf = (rows: readonly CrewRow[]): CrewRowset => ({
  subagents: rows.filter((row) => !isTeammateType(row.agentType)),
  teammates: rows.filter((row) => isTeammateType(row.agentType)),
})

export const crewSidebarRowsOf = (args: {
  rows: readonly CrewRow[]
  now: number
  viewing: string | null
  shells: readonly { threadId: string; status: EShellStatus }[]
  children: readonly { agentId: string; spawnedBy: string; status: EAgentStatus }[]
}): readonly SidebarSubagent[] =>
  args.rows.map((row) => {
    const readout = {
      status: row.status,
      startedAt: row.startedAt,
      endedAt: row.endedAt ?? null,
    }

    return {
      ...readout,
      id: row.agentId,
      name: truncateCells({
        text: oneLineOf(row.intent) ?? row.agentType,
        cells: TITLE_CELLS,
      }),
      agentType: row.agentType,
      state: subagentStateLabel({ subagent: readout, now: args.now, truncate: truncateCells }),
      model: null,
      selected: row.agentId === args.viewing,
      activity: crewActivityOf({
        id: row.agentId,
        rosters: { shells: args.shells, children: args.children },
      }),
      failureReason: row.status === EAgentStatus.Failed ? (row.prose ?? null) : null,
    }
  })

/**
 * The standings need the whole crew in one list, while the sidebar lists only the two tiers it
 * draws. `spawnedBy` stays empty because the v2 crew view carries no parent and every row is a
 * child of the open session.
 */
export const crewMemberRowsOf = (args: {
  rows: readonly CrewRow[]
  lastViewedOf: (agentId: string) => string | null
}): readonly CrewMember[] =>
  args.rows.map((row) => ({
    agentId: row.agentId,
    spawnedBy: '',
    status: row.status,
    deliveredAt: null,
    waitingOn: undefined,
    holdingShells: false,
    hasOpenPullRequest: false,
    lastViewedAt: args.lastViewedOf(row.agentId),
  }))
