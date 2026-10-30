import {
  agentDisplayName,
  catalogOf,
  findCard,
  foldCrew,
  standingsOfCrew,
  EAgentStatus,
  type CrewMember,
  type ModelCatalog,
} from '@dltech/atlas-core'
import {
  crewActivityOf,
  crewRowReading,
  contextTokensTone,
  isSubagentWorking,
  lastVisitOf,
  shellBusyThreads,
  subagentContextLabel,
  subagentShowsElapsed,
  subagentStateLabel,
  subagentWentWrong,
  type CrewActivity,
  type CrewVisits,
  type ESubagentReading,
  type EContextTone,
} from '@dltech/atlas-client/crew'
import { generatedCards } from '@dltech/atlas-models'
import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import type { AgentsPanelTeammate } from '@dltech/atlas-ui/ai/agents-panel'
import type { AgentSnapshotWire, RosterWire } from '@dltech/atlas-wire/web'

import type { AgentView } from '../../data/agents-model'

export type CrewRow = {
  id: string
  title: string
  display: EAgentDisplay
  status: EAgentStatus
  reading: ESubagentReading
  startedAt: number
  state: string
  model: string | null
  context: string | null
  contextTone: EContextTone | null
  failure: string | null
  activity: CrewActivity | undefined
  selected: boolean
  working: boolean
  teammate: boolean
}

export type CrewGroup = {
  rows: readonly CrewRow[]
  total: number
  working: number
  collapsed: number
  collapsedFailed: boolean
}

const STATUS_OF_DISPLAY: Record<EAgentDisplay, EAgentStatus> = {
  [EAgentDisplay.StartingSandbox]: EAgentStatus.Running,
  [EAgentDisplay.Running]: EAgentStatus.Running,
  [EAgentDisplay.NeedsApproval]: EAgentStatus.Blocked,
  [EAgentDisplay.Paused]: EAgentStatus.Paused,
  [EAgentDisplay.Failed]: EAgentStatus.Failed,
  [EAgentDisplay.Done]: EAgentStatus.Finished,
}

export const isWorking = (display: EAgentDisplay): boolean =>
  display === EAgentDisplay.Running ||
  display === EAgentDisplay.NeedsApproval ||
  display === EAgentDisplay.StartingSandbox

let catalog: ModelCatalog | undefined

const modelLabelOf = (model: { id: string; modelId: string } | undefined): string | null => {
  if (model === undefined) return null
  catalog ??= catalogOf(generatedCards())
  const card = findCard({ catalog, ref: { providerId: model.id, modelId: model.modelId } })
  return card?.label ?? model.modelId
}

export type CrewEntry = {
  id: string
  title: string
  display: EAgentDisplay
  teammate: boolean
  view: AgentView | undefined
}

export function crewEntriesOf(args: {
  agents: readonly AgentView[]
  teammates: readonly AgentsPanelTeammate[]
}): CrewEntry[] {
  return [
    ...args.agents.map((agent) => ({
      id: agent.id,
      title: agentDisplayName({ agentType: agent.agentType, intent: agent.intent }),
      display: agent.display,
      teammate: false,
      view: agent,
    })),
    ...args.teammates.map((teammate) => ({
      id: teammate.id,
      title: teammate.title,
      display: teammate.display,
      teammate: true,
      view: undefined,
    })),
  ]
}

const msOf = (iso: string | undefined): number | undefined => {
  if (iso === undefined) return undefined
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? undefined : parsed
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

export function crewRowsOf(args: {
  entries: readonly CrewEntry[]
  roster: RosterWire | null
  viewing: string | null
  now: number
}): CrewRow[] {
  const { roster } = args
  const snapshots = new Map<string, AgentSnapshotWire>(
    (roster?.agents ?? []).map((snapshot) => [String(snapshot.agentId), snapshot]),
  )
  const rosters = { shells: roster?.shells ?? [], children: roster?.agents ?? [] }

  return args.entries.map((entry) => {
    const snapshot = snapshots.get(entry.id)
    const status = snapshot?.status ?? STATUS_OF_DISPLAY[entry.display]
    const startedAt = entry.view?.startedAt ?? msOf(snapshot?.startedAt) ?? 0
    const endedAt = entry.view?.endedAt ?? msOf(snapshot?.endedAt)
    const activity = crewActivityOf({ id: entry.id, rosters })
    const waitingOn = snapshot?.waitingOn
    const readout = {
      status,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: endedAt === undefined ? null : new Date(endedAt).toISOString(),
      waitingOn,
    }
    const context = snapshot?.context ?? entry.view?.context
    const failure =
      status === EAgentStatus.Failed
        ? (entry.view?.errorText ?? snapshot?.failureCause ?? null)
        : null
    const row = { status, activity, waitingOn }
    return {
      id: entry.id,
      title: entry.title,
      display: entry.display,
      status,
      reading: crewRowReading(row),
      startedAt,
      state: subagentStateLabel({ subagent: readout, now: args.now }),
      model: modelLabelOf(snapshot?.model) ?? entry.view?.model ?? null,
      context: subagentContextLabel(context),
      contextTone: context === undefined ? null : contextTokensTone(context.tokens),
      failure: failure === null ? null : oneLine(failure),
      activity,
      selected: entry.id === args.viewing,
      working: isSubagentWorking(row),
      teammate: entry.teammate,
    }
  })
}

export const crewTicksOf = (entries: readonly CrewEntry[]): boolean =>
  entries.some((entry) => subagentShowsElapsed({ status: STATUS_OF_DISPLAY[entry.display] }))

export function crewMembersOf(args: {
  rows: readonly CrewRow[]
  roster: RosterWire | null
  threadId: string
  visits: CrewVisits
}): CrewMember[] {
  const { roster } = args
  const snapshots = new Map((roster?.agents ?? []).map((s) => [String(s.agentId), s]))
  const busy =
    roster === null
      ? new Set<string>()
      : shellBusyThreads({ shells: roster.shells, children: roster.agents })
  return args.rows.map((row) => {
    const snapshot = snapshots.get(row.id)
    return {
      agentId: row.id,
      spawnedBy: snapshot?.spawnedBy ?? args.threadId,
      status: row.status,
      deliveredAt:
        snapshot === undefined ? new Date(0).toISOString() : (snapshot.deliveredAt ?? null),
      lastViewedAt: lastVisitOf({ visits: args.visits, id: row.id }),
      holdingShells: busy.has(row.id),
      waitingOn: snapshot?.waitingOn,
    }
  })
}

export function crewGroupsOf(args: {
  rows: readonly CrewRow[]
  members: readonly CrewMember[]
  viewing: string | null
  expanded: { subagents: boolean; teammates: boolean }
}): { subagents: CrewGroup; teammates: CrewGroup } {
  const standings = standingsOfCrew({ crew: args.members, viewing: args.viewing })
  const groupOf = (teammate: boolean): CrewGroup => {
    const rows = args.rows
      .filter((row) => row.teammate === teammate)
      .toSorted((a, b) => a.startedAt - b.startedAt)
    const fold = foldCrew({
      rows,
      standings,
      expanded: teammate ? args.expanded.teammates : args.expanded.subagents,
      keyOf: (row) => row.id,
      wentWrong: subagentWentWrong,
    })
    return {
      rows: fold.shown.toReversed(),
      total: rows.length,
      working: rows.filter((row) => row.working).length,
      collapsed: fold.collapsed.length,
      collapsedFailed: fold.collapsedFailed,
    }
  }
  return { subagents: groupOf(false), teammates: groupOf(true) }
}
