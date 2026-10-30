import {
  ECallState,
  formatElapsed,
  inputOf,
  outputOf,
  str,
  type ToolCall,
} from '@dltech/atlas-client/transcript'
import {
  EAgentStatus,
  reachesModel,
  recordsLifecycle,
  type Event,
  type EventOfType,
} from '@dltech/atlas-core'
import type { RosterWire } from '@dltech/atlas-wire/web'

import { ETranscriptKind } from './transcript-kind'

export const SPAWN_TOOL = 'agent_spawn'
const FAILED_FALLBACK = 'The sub-agent failed'

export type SpawnItem = {
  kind: ETranscriptKind.Spawn
  id: string
  agentId: string
  agentType: string
  intent: string
  status: EAgentStatus
  brief?: string
  endedAt?: string
  result?: string
  errorText?: string
  at?: string | undefined
}

export type ReportItem = {
  kind: ETranscriptKind.Report
  id: string
  agentId: string
  agentType: string
  intent: string
  elapsed: string
  failed: boolean
  report?: string
  errorText?: string
  at?: string | undefined
}

const isSpawnItem = (row: { kind: ETranscriptKind }): row is SpawnItem =>
  row.kind === ETranscriptKind.Spawn

export const anySpawnRunning = (rows: readonly { kind: ETranscriptKind }[]): boolean =>
  rows.some((row) => isSpawnItem(row) && row.status === EAgentStatus.Running)

export const spawnDomId = (agentId: string): string => `agent-spawn-${agentId}`

export const rosterModelsOf = (roster: RosterWire | null): ReadonlyMap<string, string> =>
  new Map(
    (roster?.agents ?? []).flatMap((agent) =>
      agent.model === undefined ? [] : [[agent.agentId as string, agent.model.modelId] as const],
    ),
  )

type History = {
  firstSpawn: Map<string, EventOfType<'agent-spawned'>>
  lastEnded: Map<string, EventOfType<'agent-ended'>>
  lastReported: Map<string, EventOfType<'agent-reported'>>
  lastRestartSeq: Map<string, number>
}

function historyOf(events: readonly Event[]): History {
  const history: History = {
    firstSpawn: new Map(),
    lastEnded: new Map(),
    lastReported: new Map(),
    lastRestartSeq: new Map(),
  }
  for (const event of events) {
    if (!recordsLifecycle(event)) continue
    if (event.type === 'agent-spawned' && !history.firstSpawn.has(event.agentId)) {
      history.firstSpawn.set(event.agentId, event)
    }
    if (event.type === 'agent-ended') history.lastEnded.set(event.agentId, event)
    if (event.type === 'agent-reported') history.lastReported.set(event.agentId, event)
    if (event.type === 'agent-restarted') history.lastRestartSeq.set(event.agentId, event.seq)
  }
  return history
}

const proseOf = (prose: string | undefined): string | undefined =>
  prose === undefined || prose.trim() === '' ? undefined : prose

function elapsedBetween(args: { from: string | undefined; to: string }): string {
  if (args.from === undefined) return ''
  const span = Date.parse(args.to) - Date.parse(args.from)
  return Number.isNaN(span) ? '' : formatElapsed(Math.max(0, span))
}

function currentEnding(args: {
  history: History
  agentId: string
}): EventOfType<'agent-ended'> | undefined {
  const ended = args.history.lastEnded.get(args.agentId)
  if (ended === undefined) return undefined
  const restartedAt = args.history.lastRestartSeq.get(args.agentId) ?? -1
  return restartedAt > ended.seq ? undefined : ended
}

function spawnItemOf(args: { spawn: EventOfType<'agent-spawned'>; history: History }): SpawnItem {
  const { spawn, history } = args
  const ended = currentEnding({ history, agentId: spawn.agentId })
  const status = ended?.status ?? EAgentStatus.Running
  const failed = status === EAgentStatus.Failed
  const reported = proseOf(history.lastReported.get(spawn.agentId)?.prose)
  const result = ended === undefined ? reported : (proseOf(ended.prose) ?? reported)
  const errorText = failed
    ? (ended?.failureCause ?? proseOf(ended?.prose) ?? FAILED_FALLBACK)
    : undefined
  return {
    kind: ETranscriptKind.Spawn,
    id: spawn.id,
    agentId: spawn.agentId,
    agentType: spawn.agentType,
    intent: spawn.intent,
    status,
    at: spawn.at,
    ...(ended === undefined ? {} : { endedAt: ended.at }),
    ...(result === undefined || failed ? {} : { result }),
    ...(errorText === undefined ? {} : { errorText }),
  }
}

export function spawnItemsOf(events: readonly Event[]): SpawnItem[] {
  const history = historyOf(events)
  return events.flatMap((event) =>
    event.type === 'agent-spawned' && history.firstSpawn.get(event.agentId) === event
      ? [spawnItemOf({ spawn: event, history })]
      : [],
  )
}

function reportItemOf(args: {
  event: EventOfType<'agent-reported'> | EventOfType<'agent-ended'>
  history: History
}): ReportItem | null {
  const { event, history } = args
  const base = {
    kind: ETranscriptKind.Report as const,
    id: event.id as string,
    agentId: event.agentId as string,
    agentType: event.agentType,
    intent: event.intent,
    elapsed: elapsedBetween({
      from: history.firstSpawn.get(event.agentId)?.at,
      to: event.at,
    }),
    at: event.at,
  }
  const prose = proseOf(event.prose)
  if (event.type === 'agent-reported') {
    return {
      ...base,
      failed: false,
      ...(prose === undefined ? {} : { report: prose }),
    }
  }
  if (event.relayed === false) return null
  if (event.status === EAgentStatus.Failed) {
    return {
      ...base,
      failed: true,
      errorText: event.failureCause ?? prose ?? FAILED_FALLBACK,
    }
  }
  return prose === undefined ? null : { ...base, failed: false, report: prose }
}

export function reportItemsOf(events: readonly Event[]): Map<string, ReportItem> {
  const history = historyOf(events)
  const reports = new Map<string, ReportItem>()
  for (const event of events) {
    if (event.type !== 'agent-reported' && event.type !== 'agent-ended') continue
    if (!reachesModel(event)) continue
    const item = reportItemOf({ event, history })
    if (item !== null) reports.set(item.id, item)
  }
  return reports
}

function poolMatchOf(args: {
  call: ToolCall
  pool: ReadonlyMap<string, SpawnItem>
}): SpawnItem | undefined {
  const agentId = str(outputOf(args.call).agentId)
  if (agentId !== undefined) return args.pool.get(agentId)
  if (args.call.state !== ECallState.Pending) return undefined
  const input = inputOf(args.call)
  return [...args.pool.values()].find(
    (spawn) => spawn.agentType === str(input.agentType) && spawn.intent === str(input.intent),
  )
}

export function claimSpawn(args: {
  call: ToolCall
  pool: Map<string, SpawnItem>
}): SpawnItem | undefined {
  if (args.call.name !== SPAWN_TOOL) return undefined
  const match = poolMatchOf(args)
  if (match === undefined) return undefined
  args.pool.delete(match.agentId)
  const brief = str(inputOf(args.call).brief)
  return brief === undefined ? match : { ...match, brief }
}

const timeOf = (at: string | undefined): number => {
  const time = at === undefined ? Number.NaN : Date.parse(at)
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

export function withInserted<TItem extends { at?: string | undefined }>(args: {
  items: readonly TItem[]
  inserted: readonly (SpawnItem | ReportItem)[]
}): (TItem | SpawnItem | ReportItem)[] {
  const merged: (TItem | SpawnItem | ReportItem)[] = [...args.items]
  for (const extra of args.inserted) {
    const found = merged.findIndex((item) => timeOf(item.at) > timeOf(extra.at))
    merged.splice(found === -1 ? merged.length : found, 0, extra)
  }
  return merged
}
