import { EAgentStatus } from '@dltech/atlas-core'
import { pluginViewOf } from '@dltech/atlas-client/stream'
import type { ClientSlot } from '@dltech/atlas-plugin-sdk'

import { CREW_VIEW, crewViewSchema, type CrewRow } from '../core'

export { crewCoreSlots } from '../core'
export type { CrewRow } from '../core'

export const crewClient: ClientSlot = {
  hooks: [
    {
      name: 'crew-roster',
      appliesTo: (event) => event.type.startsWith('agent-'),
    },
  ],
}

export const crewOfView = (views: Readonly<Record<string, unknown>>): readonly CrewRow[] =>
  pluginViewOf({
    views,
    name: CREW_VIEW,
    schema: crewViewSchema,
  }) ?? []

export type CrewRoster = { running: number; total: number }

export const crewRosterOf = (views: Readonly<Record<string, unknown>>): CrewRoster => {
  const rows = crewOfView(views)
  return {
    running: rows.filter((row) => row.status === EAgentStatus.Running).length,
    total: rows.length,
  }
}
