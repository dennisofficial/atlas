import {
  compactionTarget,
  ECompactionAnchor,
  eventsOfType,
  rowsOwnedBy,
  suffixCompactionTarget,
  survivesSummary,
  type ClockPort,
  type Event,
  type EventDraft,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../../../agents/registry/port'
import {
  ECompactionFailure,
  type CompactionOutcome,
  type Summarise,
} from '../../compact'
import type { JsonlEventLog } from '../event-log'
import type { SessionRegistry } from '../registry'
import { dropRewoundChildren } from './children'
import { draftOf } from './log-edits'

const NO_SUMMARY = 'the summariser returned nothing, so the thread was left as it was'

type Range = { fromSeq: number; throughSeq: number }

function rangeFor({
  events,
  anchor,
  seq,
}: {
  events: readonly Event[]
  anchor: ECompactionAnchor
  seq: number
}): Range {
  const firstSeq = events[0]?.seq ?? seq
  const lastSeq = events.at(-1)?.seq ?? seq

  return anchor === ECompactionAnchor.Prefix
    ? { fromSeq: firstSeq, throughSeq: seq }
    : { fromSeq: seq, throughSeq: lastSeq }
}

const targetFor = ({
  events,
  anchor,
  seq,
}: {
  events: readonly Event[]
  anchor: ECompactionAnchor
  seq: number
}) =>
  anchor === ECompactionAnchor.Prefix
    ? compactionTarget({ events, throughSeq: seq })
    : suffixCompactionTarget({ events, fromSeq: seq })

function delegationsCutBy({
  events,
  threadId,
  fromSeq,
  throughSeq,
}: {
  events: readonly Event[]
  threadId: ThreadId
  fromSeq: number
  throughSeq: number
}): readonly ThreadId[] {
  const owned = rowsOwnedBy({ events, threadId })
  const inRange = (seq: number): boolean => seq >= fromSeq && seq <= throughSeq

  const endingsKept = new Set(
    eventsOfType({ events: owned, type: 'agent-ended' })
      .filter((ending) => !inRange(ending.seq))
      .map((ending) => ending.agentId),
  )

  return eventsOfType({ events: owned, type: 'agent-spawned' })
    .filter((spawn) => inRange(spawn.seq) && !endingsKept.has(spawn.agentId))
    .map((spawn) => spawn.agentId)
}

function composeDrafts({
  owned,
  anchor,
  range,
  summary,
  destructive,
}: {
  owned: readonly Event[]
  anchor: ECompactionAnchor
  range: Range
  summary: string
  destructive: boolean
}): { drafts: EventDraft[]; replaced: number } {
  const inRange = (event: Event): boolean =>
    event.seq >= range.fromSeq && event.seq <= range.throughSeq
  const covered = owned.filter((event) => inRange(event) && !survivesSummary(event.type))

  const standIn: EventDraft = {
    type: 'history-compacted',
    anchor,
    fromSeq: range.fromSeq,
    throughSeq: range.throughSeq,
    summary,
    replaced: covered.length,
  }

  if (!destructive) return { drafts: [...owned.map(draftOf), standIn], replaced: covered.length }

  const kept = owned.filter((event) => !inRange(event) || survivesSummary(event.type))
  const standInSeq =
    anchor === ECompactionAnchor.Prefix ? covered.at(-1)?.seq : covered[0]?.seq
  if (standInSeq === undefined) {
    return { drafts: [...kept.map(draftOf), standIn], replaced: covered.length }
  }

  const before = kept.filter((event) => event.seq < standInSeq).map(draftOf)
  const after = kept.filter((event) => event.seq > standInSeq).map(draftOf)
  return { drafts: [...before, standIn, ...after], replaced: covered.length }
}

export async function compactThread(args: {
  log: JsonlEventLog
  registry: SessionRegistry
  clock: ClockPort
  ids: IdPort
  agents: AgentRegistryPort
  threadId: ThreadId
  anchor: ECompactionAnchor
  seq: number
  summarise: Summarise
  destructive?: boolean | undefined
  signal?: AbortSignal | undefined
}): Promise<CompactionOutcome> {
  const { log, registry, clock, ids, agents, threadId, anchor, seq, summarise, signal } = args
  const events = await log.read({ threadId })

  const target = targetFor({ events, anchor, seq })
  if (!target.allowed) {
    return {
      ok: false,
      failure: ECompactionFailure.Refused,
      reason: target.reason,
      refusal: target.refusal,
    }
  }

  const range = rangeFor({ events, anchor, seq })

  const summary = await summarise({ events, ...range, ...(signal === undefined ? {} : { signal }) })
  if (summary === null) {
    return { ok: false, failure: ECompactionFailure.NoSummary, reason: NO_SUMMARY }
  }

  const sessionDir = await log.sessionDirFor({ threadId })
  const owned = await log.readOwn({ threadId })
  const destructive = args.destructive === true
  const { drafts, replaced } = composeDrafts({ owned, anchor, range, summary, destructive })

  await log.replace({ threadId, runId: ids.nextRunId(), drafts })

  if (destructive) {
    const cutAgents = delegationsCutBy({ events, threadId, ...range })
    await dropRewoundChildren({ registry, sessionDir, agentIds: cutAgents, at: clock.now() })
    await agents.removeChildren({ threadId, agentIds: cutAgents })
  }

  return { ok: true, anchor, ...range, replaced, summary }
}
