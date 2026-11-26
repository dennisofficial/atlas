import {
  EMPTY_VISIBILITY,
  agentLifecycleKind,
  agentRoster,
  EAgentStatus,
  INBOX_KIND_EVENT,
  inboxEventOf,
  isSurviving,
  lifecycleOf,
  pendingInputsOf,
  recordsLifecycle,
  stepVisibility,
  unendedSpawns,
  type Event,
  type EventOfType,
  type ThreadId,
  type RecordEvent,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { WorktreeEntryInfo } from '@dltech/atlas-plugin-sdk'

import { readInboxPages } from '../held-inbox'
import type { SessionRecord } from '../record/record-adapter'
import {
  CHILD_READ_CONCURRENCY,
  childWaitsOnInput,
  loopEventsOf,
  threadEventsOf,
} from './child-reads'
import { pooledMap } from './pooled-map'

export type ChildSettlement = { status: EAgentStatus; endedAt: string }

export type OpenChild = {
  agentId: ThreadId
  agentType: string
  intent: string
  group: string | undefined
  spawnedAt: string
  worktree: WorktreeEntryInfo | undefined
  callId?: string | undefined
  settled?: ChildSettlement | undefined
  keepIdle?: boolean | undefined
}

const openChildOf = (spawn: EventOfType<'agent-spawned'>): OpenChild => ({
  agentId: spawn.agentId,
  agentType: spawn.agentType,
  intent: spawn.intent,
  group: spawn.group,
  spawnedAt: spawn.at,
  worktree: spawn.worktree,
  ...(spawn.callId === undefined ? {} : { callId: spawn.callId }),
})

const answeredCallIdsOf = (
  events: readonly { type: string; callId?: string | undefined }[],
): ReadonlySet<string> => {
  const answered = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool-result') continue
    if (event.callId !== undefined) answered.add(event.callId)
  }
  return answered
}

const waitsOnItsCallOf = (args: { child: OpenChild; answered: ReadonlySet<string> }): boolean =>
  args.child.settled === undefined &&
  args.child.callId !== undefined &&
  !args.answered.has(args.child.callId)

const settledStatusOf = (status: EAgentStatus): EAgentStatus =>
  status === EAgentStatus.Running ? EAgentStatus.Stopped : status

const settlementOf = (ending: EventOfType<'agent-ended'>): ChildSettlement => ({
  status: settledStatusOf(ending.status),
  endedAt: ending.at,
})

export const openChildrenOf = (events: readonly Event[]): readonly OpenChild[] => {
  const answered = answeredCallIdsOf(events)
  return unendedSpawns(events)
    .map(openChildOf)
    .filter((child) => !waitsOnItsCallOf({ child, answered }))
}

const lastLifecycleSeqOf = (events: readonly Event[]): ReadonlyMap<ThreadId, number> => {
  const seqs = new Map<ThreadId, number>()
  for (const event of events) {
    if (event.type !== 'agent-spawned' && event.type !== 'agent-restarted') continue
    seqs.set(event.agentId as ThreadId, event.seq)
  }
  return seqs
}

const lastEndingOf = (
  events: readonly Event[],
): ReadonlyMap<ThreadId, EventOfType<'agent-ended'>> => {
  const endings = new Map<ThreadId, EventOfType<'agent-ended'>>()
  for (const event of events) {
    if (event.type !== 'agent-ended' || !recordsLifecycle(event)) continue
    endings.set(event.agentId as ThreadId, event)
  }
  return endings
}

const settledSince = (args: {
  ending: EventOfType<'agent-ended'> | undefined
  lifecycleSeq: number | undefined
}): ChildSettlement | undefined => {
  const ending = args.ending
  if (ending === undefined) return undefined
  if (args.lifecycleSeq !== undefined && args.lifecycleSeq > ending.seq) return undefined
  return settlementOf(ending)
}

export const spawnedChildrenOf = (events: readonly Event[]): readonly OpenChild[] => {
  const byAgent = new Map<ThreadId, OpenChild>()
  const lifecycleSeqs = lastLifecycleSeqOf(events)
  const endings = lastEndingOf(events)
  for (const lifecycle of lifecycleOf(events, agentLifecycleKind)) {
    const agentId = lifecycle.key as ThreadId
    const settled = settledSince({
      ending: endings.get(agentId),
      lifecycleSeq: lifecycleSeqs.get(agentId),
    })
    byAgent.set(agentId, {
      ...openChildOf(lifecycle.started),
      ...(settled === undefined ? {} : { settled }),
    })
  }
  return [...byAgent.values()]
}

export type SettledChild = OpenChild & { status: EAgentStatus; endedAt: string }

export const settledChildOf = (args: {
  events: readonly Event[]
  threadId: ThreadId
  agentId: ThreadId
}): SettledChild | undefined => {
  const spawn = args.events.findLast(
    (event): event is EventOfType<'agent-spawned'> =>
      event.type === 'agent-spawned' && event.agentId === args.agentId,
  )
  const agent = agentRoster({ events: args.events, threadId: args.threadId }).find(
    (candidate) => candidate.agentId === args.agentId && candidate.endedAt !== undefined,
  )
  if (spawn === undefined || agent?.endedAt === undefined) return undefined
  return { ...openChildOf(spawn), status: agent.status, endedAt: agent.endedAt }
}

const wasCompacted = (events: readonly RecordEvent[]): boolean =>
  events.some((event) => event.type === 'history-summarised')

const survivingEventsOf = async (args: {
  record: SessionRecord
  plane: ControlPlane
  threadId: ThreadId
}): Promise<RecordEvent[]> => {
  const cached = args.record.eventCache().eventsAfter(0)
  const events = wasCompacted(cached)
    ? await threadEventsOf({ plane: args.plane, threadId: args.threadId, visible: false })
    : cached
  const visibility = events.reduce(stepVisibility, EMPTY_VISIBILITY)
  return events.filter((event) => isSurviving(visibility, event))
}

const pendingSettlementsOf = async (args: {
  plane: ControlPlane
  sessionId: string
  events: readonly RecordEvent[]
}): Promise<ReadonlyMap<ThreadId, ChildSettlement>> => {
  const settlements = new Map<ThreadId, ChildSettlement>()
  for (const pending of pendingInputsOf(args.events).pending) {
    if (pending.event?.type !== 'agent-ended') continue
    settlements.set(pending.event.agentId, {
      status: settledStatusOf(pending.event.status),
      endedAt: pending.at,
    })
  }
  const entries = await readInboxPages({
    plane: args.plane,
    sessionId: args.sessionId,
    forThread: null,
  })
  for (const entry of entries) {
    if (entry.kind !== INBOX_KIND_EVENT) continue
    const read = inboxEventOf(entry.payload)
    if (!read.ok || read.event.type !== 'agent-ended') continue
    settlements.set(read.event.agentId, {
      status: settledStatusOf(read.event.status),
      endedAt: entry.postedAt,
    })
  }
  return settlements
}

const needsSpawnInit = async (args: { plane: ControlPlane; child: OpenChild }): Promise<boolean> =>
  threadEventsOf({ plane: args.plane, threadId: args.child.agentId, visible: false })
    .then((events) => events.length === 0)
    .catch(() => true)

const startedChildrenOf = async (args: {
  plane: ControlPlane
  children: readonly OpenChild[]
  answered: ReadonlySet<string>
}): Promise<readonly OpenChild[]> => {
  const kept = await pooledMap({
    items: args.children,
    limit: CHILD_READ_CONCURRENCY,
    work: async (child) =>
      waitsOnItsCallOf({ child, answered: args.answered }) &&
      (await needsSpawnInit({ plane: args.plane, child }))
        ? undefined
        : child,
  })
  return kept.filter((child): child is OpenChild => child !== undefined)
}

export const openChildren = async (args: {
  record: SessionRecord
  plane: ControlPlane
  sessionId: string
  threadId: ThreadId
}): Promise<readonly OpenChild[]> => {
  const events = await survivingEventsOf(args)
  const children = await startedChildrenOf({
    plane: args.plane,
    children: spawnedChildrenOf(loopEventsOf(events)),
    answered: answeredCallIdsOf(events),
  })
  const open = children.filter((child) => child.settled === undefined)
  const pending =
    open.length === 0
      ? new Map<ThreadId, ChildSettlement>()
      : await pendingSettlementsOf({
          plane: args.plane,
          sessionId: args.sessionId,
          events,
        })
  const checked = await pooledMap({
    items: children,
    limit: CHILD_READ_CONCURRENCY,
    work: (child) =>
      driveableOf({
        plane: args.plane,
        sessionId: args.sessionId,
        child,
        awaited: pending.get(child.agentId),
      }),
  })
  return checked.filter((child): child is OpenChild => child !== undefined)
}

const driveableOf = async (args: {
  plane: ControlPlane
  sessionId: string
  child: OpenChild
  awaited: ChildSettlement | undefined
}): Promise<OpenChild | undefined> => {
  const { child, awaited } = args
  if (child.settled === undefined && awaited === undefined) return child
  const waitsOnInput = await childWaitsOnInput(args)
  if (child.settled !== undefined) return waitsOnInput ? child : undefined
  return { ...child, settled: awaited, keepIdle: !waitsOnInput }
}
