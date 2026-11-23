import type { Event, SpendTally } from '@dltech/atlas-core'
import type { ECrewStanding } from '@dltech/atlas-core'
import type { StreamSessionRow } from '@dltech/atlas-protocol'

import { NOTHING_TALLIED, type SidebarSpend } from '../store/sidebar-spend'
import {
  sidebarFoldOf,
  withCrew,
  withSections,
  type SidebarModel,
  type SidebarTask,
  type SidebarTeammate,
} from '../store/sidebar-model'
import type { SidebarSubagent } from '../store/subagent-row'
import { oneLineOf } from '../store/sidebar-text'
import type { SidebarSection } from '../ui/sidebar-section'
import { planTasksOf, type SessionPanes } from './session-view'

export const spendOf = (tally: SpendTally | null): SidebarSpend => {
  if (tally === null) return NOTHING_TALLIED

  return {
    totals: {
      turns: 0,
      steps: 0,
      inputTokens: tally.inputTokens,
      outputTokens: tally.outputTokens,
      cacheReadTokens: tally.cacheReadTokens,
      cacheWriteTokens: tally.cacheWriteTokens,
    },
    costUsd: tally.costUsd,
  }
}

const labelOf = (row: StreamSessionRow): string => {
  const title = row.title?.trim() ?? ''
  return title === '' ? row.sessionId : title
}

const activityOf = (row: StreamSessionRow): string | null => {
  if (row.archivedAt !== null) return 'archived'
  return row.status?.state ?? null
}

export const teammatesOf = (args: {
  rows: readonly StreamSessionRow[]
  now: number
}): readonly SidebarTeammate[] =>
  args.rows
    .filter((row) => row.spawnedBy !== null && row.spawnedBy !== undefined)
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((row) => ({
      id: row.sessionId,
      name: labelOf(row),
      activity: activityOf(row),
    }))

export const sidebarModelOf = (args: {
  events: readonly Event[]
  name: string | null
  panes: SessionPanes
  crew: { rows: readonly SidebarSubagent[]; standings: ReadonlyMap<string, ECrewStanding> }
  teammates: readonly StreamSessionRow[]
  sections: readonly SidebarSection[]
  now: number
}): SidebarModel => {
  const fold = sidebarFoldOf(args.events)
  const todo: readonly SidebarTask[] =
    fold.todo.length > 0 ? fold.todo : planTasksOf(args.panes.plan)
  const named = args.name === null ? null : oneLineOf(args.name)
  const title = named ?? fold.opening

  const base: SidebarModel = {
    title: title === null ? null : oneLineOf(title),
    turnCount: fold.turnCount,
    spend: spendOf(args.panes.spend),
    lastActivity: fold.lastActivity,
    ...(todo.length === 0 ? {} : { todo }),
    ...(fold.classifier === null ? {} : { classifier: fold.classifier }),
  }
  const teammates = teammatesOf({ rows: args.teammates, now: args.now })
  const withTeammates = teammates.length === 0 ? base : { ...base, teammates }

  return withSections({
    model: withCrew({
      model: withTeammates,
      subagents: args.crew.rows,
      standings: args.crew.standings,
    }),
    sections: args.sections,
  })
}
