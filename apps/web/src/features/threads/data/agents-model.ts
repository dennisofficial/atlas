import { EAgentStatus, isTeammateType, recordsLifecycle, type Event } from '@dltech/atlas-core'
import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import type { AgentContext, AgentsPanelTeammate } from '@dltech/atlas-ui/ai/agents-panel'
import type { AgentSnapshotWire, RosterWire, WireThread } from '@dltech/atlas-wire/web'

import { UNTITLED } from './untitled'

export type AgentRecord = {
  id: string
  agentType: string
  intent: string
  spawnedAt: string
  status: EAgentStatus
  endedAt: string | undefined
  failureCause: string | undefined
  prose: string | undefined
  reported: string | undefined
  toolCalls: number | undefined
}

export type AgentView = {
  id: string
  agentType: string
  intent: string
  display: EAgentDisplay
  live: boolean
  startedAt: number | undefined
  endedAt: number | undefined
  model: string | undefined
  context: AgentContext | undefined
  latestCall: string | undefined
  report: string | undefined
  errorText: string | undefined
  toolCalls: number
  teammate: boolean
}

type Identity = { agentId: string; agentType: string; intent: string }

const FAILED_FALLBACK = 'The run failed.'
const STARTING = 'Starting'

const DISPLAY_OF_STATUS: Record<EAgentStatus, EAgentDisplay> = {
  [EAgentStatus.Running]: EAgentDisplay.Running,
  [EAgentStatus.Blocked]: EAgentDisplay.NeedsApproval,
  [EAgentStatus.Paused]: EAgentDisplay.Paused,
  [EAgentStatus.Failed]: EAgentDisplay.Failed,
  [EAgentStatus.Finished]: EAgentDisplay.Done,
  [EAgentStatus.Stopped]: EAgentDisplay.Done,
}

const LIVE_STATUSES: readonly EAgentStatus[] = [
  EAgentStatus.Running,
  EAgentStatus.Blocked,
  EAgentStatus.Paused,
]

const nonEmpty = (text: string | undefined): string | undefined =>
  text === undefined || text.trim().length === 0 ? undefined : text

function millisOf(iso: string | undefined): number | undefined {
  if (iso === undefined) return undefined
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? undefined : parsed
}

const freshRecord = (args: { identity: Identity; at: string }): AgentRecord => ({
  id: args.identity.agentId,
  agentType: args.identity.agentType,
  intent: args.identity.intent,
  spawnedAt: args.at,
  status: EAgentStatus.Running,
  endedAt: undefined,
  failureCause: undefined,
  prose: undefined,
  reported: undefined,
  toolCalls: undefined,
})

export function agentRecordsOf(events: readonly Event[]): AgentRecord[] {
  const records = new Map<string, AgentRecord>()
  const recordOf = (args: { identity: Identity; at: string }): AgentRecord =>
    records.get(args.identity.agentId) ?? freshRecord(args)

  for (const event of events) {
    if (!recordsLifecycle(event)) continue
    if (event.type === 'agent-spawned') {
      records.set(event.agentId, freshRecord({ identity: event, at: event.at }))
    } else if (event.type === 'agent-restarted') {
      records.set(event.agentId, {
        ...recordOf({ identity: event, at: event.at }),
        status: EAgentStatus.Running,
        endedAt: undefined,
        failureCause: undefined,
        prose: undefined,
      })
    } else if (event.type === 'agent-ended') {
      records.set(event.agentId, {
        ...recordOf({ identity: event, at: event.at }),
        status: event.status,
        endedAt: event.at,
        failureCause: event.failureCause,
        prose: event.prose,
        toolCalls: event.toolCalls,
      })
    } else if (event.type === 'agent-reported') {
      records.set(event.agentId, {
        ...recordOf({ identity: event, at: event.at }),
        reported: event.prose,
      })
    }
  }
  return [...records.values()]
}

const recordOfSnapshot = (snapshot: AgentSnapshotWire): AgentRecord => ({
  id: snapshot.agentId,
  agentType: snapshot.agentType,
  intent: snapshot.intent,
  spawnedAt: snapshot.startedAt,
  status: snapshot.status,
  endedAt: snapshot.endedAt,
  failureCause: snapshot.failureCause,
  prose: undefined,
  reported: undefined,
  toolCalls: snapshot.toolCalls,
})

function latestCallOf(args: {
  status: EAgentStatus
  snapshot: AgentSnapshotWire | undefined
}): string | undefined {
  if (args.status !== EAgentStatus.Running) return undefined
  const tool = args.snapshot?.lastTool
  return tool === undefined ? STARTING : `Using ${tool}`
}

function statusOf(args: {
  record: AgentRecord
  snapshot: AgentSnapshotWire | undefined
  connected: boolean
}): EAgentStatus {
  const { record, snapshot, connected } = args
  if (record.endedAt !== undefined) return record.status
  if (snapshot !== undefined) return snapshot.status
  if (record.status === EAgentStatus.Running && !connected) return EAgentStatus.Paused
  return record.status
}

function viewOf(args: {
  record: AgentRecord
  snapshot: AgentSnapshotWire | undefined
  connected: boolean
}): AgentView {
  const { record, snapshot } = args
  const status = statusOf(args)
  const live = LIVE_STATUSES.includes(status)
  const display = DISPLAY_OF_STATUS[status]
  return {
    id: record.id,
    agentType: record.agentType,
    intent: record.intent,
    display,
    live,
    startedAt: millisOf(snapshot?.startedAt ?? record.spawnedAt),
    endedAt: live ? undefined : millisOf(record.endedAt ?? snapshot?.endedAt),
    model: snapshot?.model?.modelId,
    context: snapshot?.context,
    latestCall: latestCallOf({ status, snapshot }),
    report:
      display === EAgentDisplay.Done
        ? (nonEmpty(record.prose) ?? nonEmpty(record.reported))
        : undefined,
    errorText:
      status === EAgentStatus.Failed
        ? (nonEmpty(record.failureCause) ?? nonEmpty(record.prose) ?? FAILED_FALLBACK)
        : undefined,
    toolCalls: snapshot?.toolCalls ?? record.toolCalls ?? 0,
    teammate: isTeammateType(record.agentType),
  }
}

const ownedAgentsOf = (args: { threadId: string; roster: RosterWire | null }) =>
  (args.roster?.agents ?? []).filter((agent) => agent.spawnedBy === args.threadId)

export function agentViewsOf(args: {
  threadId: string
  records: readonly AgentRecord[]
  roster: RosterWire | null
}): AgentView[] {
  const connected = args.roster !== null
  const owned = ownedAgentsOf(args)
  const snapshots = new Map<string, AgentSnapshotWire>(owned.map((agent) => [agent.agentId, agent]))
  const known = new Set(args.records.map((record) => record.id))
  const fromRoster = owned.filter((agent) => !known.has(agent.agentId)).map(recordOfSnapshot)
  return [...args.records, ...fromRoster].map((record) =>
    viewOf({ record, snapshot: snapshots.get(record.id), connected }),
  )
}

export const rosterKeyOf = (args: { threadId: string; roster: RosterWire | null }): string =>
  ownedAgentsOf(args)
    .map((agent) => `${agent.agentId}:${agent.status}`)
    .join(',')

export function teammatesOf(args: {
  spawned: readonly WireThread[]
  views: readonly AgentView[]
}): AgentsPanelTeammate[] {
  const displays = new Map(args.views.map((view) => [view.id, view.display]))
  return args.spawned
    .filter((thread) => thread.agent !== undefined && isTeammateType(thread.agent.type))
    .map((thread) => ({
      id: thread.id,
      title: nonEmpty(thread.title) ?? UNTITLED,
      display: displays.get(thread.id) ?? EAgentDisplay.Done,
    }))
}

export const isActiveDisplay = (display: EAgentDisplay): boolean =>
  display === EAgentDisplay.Running || display === EAgentDisplay.NeedsApproval

export const activeAgentCount = (views: readonly AgentView[]): number =>
  views.filter((view) => !view.teammate && isActiveDisplay(view.display)).length
