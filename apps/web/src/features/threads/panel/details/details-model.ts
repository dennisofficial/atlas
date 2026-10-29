import {
  EAgentStatus,
  EKilledBy,
  EPlanStatus,
  EServiceStatus,
  foldCrew,
  standingsOfCrew,
  type CrewMember,
  type Event,
  type FoldableService,
  type SpendTally,
} from '@dltech/atlas-core'
import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import {
  EServiceStatus as EWireServiceStatus,
  type AgentSnapshotWire,
  type ServiceSnapshotWire,
} from '@dltech/atlas-wire/web'

import type { AgentView } from '../../data/agents-model'

const THOUSAND = 1_000
const MILLION = 1_000_000
const BILLION = 1_000_000_000
const ACKNOWLEDGED = new Date(0).toISOString()

export function formatTokens(tokens: number): string {
  if (tokens < THOUSAND) return String(tokens)
  if (tokens < MILLION) return `${(tokens / THOUSAND).toFixed(1)}k`
  if (tokens < BILLION) return `${(tokens / MILLION).toFixed(2)}m`
  return `${(tokens / BILLION).toFixed(2)}b`
}

export const turnCountOf = (events: readonly Event[]): number =>
  events.filter((event) => event.type === 'user-said').length

export const turnsLabelOf = (turns: number): string => `${turns} ${turns === 1 ? 'turn' : 'turns'}`

export function tokenFiguresOf(spend: SpendTally): string | null {
  if (spend.inputTokens === 0 && spend.outputTokens === 0) return null
  const figures = [
    `↑ ${formatTokens(spend.uncachedInputTokens)}`,
    `↓ ${formatTokens(spend.outputTokens)}`,
  ]
  if (spend.cacheReadTokens > 0) figures.push(`cache ${formatTokens(spend.cacheReadTokens)}`)
  return figures.join('  ')
}

export const planCountOf = (tasks: readonly { status: EPlanStatus }[]): string =>
  `${tasks.filter((task) => task.status === EPlanStatus.Completed).length}/${tasks.length}`

export const planDoneLabelOf = (args: { hidden: number; expanded: boolean }): string =>
  args.expanded ? 'Show fewer' : `${args.hidden} earlier done`

const SERVICE_STATUS: Record<EWireServiceStatus, EServiceStatus> = {
  [EWireServiceStatus.Running]: EServiceStatus.Running,
  [EWireServiceStatus.Exited]: EServiceStatus.Exited,
  [EWireServiceStatus.Killed]: EServiceStatus.Killed,
}

export type KeptService = FoldableService & { snapshot: ServiceSnapshotWire }

export const keptServiceOf = (snapshot: ServiceSnapshotWire): KeptService => ({
  serviceId: snapshot.serviceId,
  status: SERVICE_STATUS[snapshot.status],
  exitCode: snapshot.exitCode,
  killedBy: Object.values(EKilledBy).find((killed) => String(killed) === snapshot.killedBy),
  snapshot,
})

export const earlierLabelOf = (args: { hidden: number; failed: boolean }): string =>
  `+${args.hidden} earlier${args.failed ? ' · one failed' : ''}`

export type CrewRow = {
  id: string
  title: string
  subtitle: string | undefined
  display: EAgentDisplay
  teammate: boolean
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

export function crewRowsOf(args: {
  agents: readonly AgentView[]
  teammates: readonly { id: string; title: string; display: EAgentDisplay }[]
}): CrewRow[] {
  return [
    ...args.agents.map((agent) => ({
      id: agent.id,
      title: agent.intent,
      subtitle: agent.agentType,
      display: agent.display,
      teammate: false,
    })),
    ...args.teammates.map((teammate) => ({
      id: teammate.id,
      title: teammate.title,
      subtitle: undefined,
      display: teammate.display,
      teammate: true,
    })),
  ]
}

export function crewMembersOf(args: {
  rows: readonly CrewRow[]
  snapshots: readonly AgentSnapshotWire[]
  threadId: string
}): CrewMember[] {
  const snapshots = new Map(args.snapshots.map((snapshot) => [String(snapshot.agentId), snapshot]))
  return args.rows.map((row) => {
    const snapshot = snapshots.get(row.id)
    return {
      agentId: row.id,
      spawnedBy: snapshot?.spawnedBy ?? args.threadId,
      status: STATUS_OF_DISPLAY[row.display],
      deliveredAt: snapshot === undefined ? ACKNOWLEDGED : (snapshot.deliveredAt ?? null),
      lastViewedAt: ACKNOWLEDGED,
      waitingOn: snapshot?.waitingOn,
    }
  })
}

export type CrewGroup = {
  rows: readonly CrewRow[]
  total: number
  working: number
  collapsed: number
  collapsedFailed: boolean
}

export function crewGroupsOf(args: {
  rows: readonly CrewRow[]
  members: readonly CrewMember[]
  viewing: string | null
  expanded: { subagents: boolean; teammates: boolean }
}): { subagents: CrewGroup; teammates: CrewGroup } {
  const standings = standingsOfCrew({
    crew: args.members,
    viewing: args.viewing,
  })
  const groupOf = (teammate: boolean): CrewGroup => {
    const rows = args.rows.filter((row) => row.teammate === teammate)
    const fold = foldCrew({
      rows,
      standings,
      expanded: teammate ? args.expanded.teammates : args.expanded.subagents,
      keyOf: (row) => row.id,
      wentWrong: (row) => row.display === EAgentDisplay.Failed,
    })
    return {
      rows: fold.shown,
      total: rows.length,
      working: rows.filter((row) => isWorking(row.display)).length,
      collapsed: fold.collapsed.length,
      collapsedFailed: fold.collapsedFailed,
    }
  }
  return { subagents: groupOf(false), teammates: groupOf(true) }
}

export const settledLabelOf = (args: {
  collapsed: number
  expanded: boolean
  failed: boolean
}): string =>
  args.expanded ? 'Show fewer' : `${args.collapsed} settled${args.failed ? ' · one failed' : ''}`
