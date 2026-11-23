import {
  EMPTY_VISIBILITY,
  agentLifecycleKind,
  agentRoster,
  EAgentStatus,
  INBOX_KIND_EVENT,
  inboxEventOf,
  isSurviving,
  lifecycleOf,
  loopStateOf,
  owesEndingOf,
  pendingInputsOf,
  recordsLifecycle,
  stepVisibility,
  toLoopEvent,
  unendedSpawns,
  type Event,
  type EventOfType,
  type ThreadId,
  type V2Event,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { WorktreeEntryInfo } from '@dltech/atlas-plugin-sdk'

import { logPendingInputIdsOf, readInboxPages, readThreadInbox } from '../held-inbox'
import type { SessionRecord } from '../record/record-adapter'

const READ_LIMIT = 1000

export type ChildSettlement = { status: EAgentStatus; endedAt: string }

export type OpenChild = {
  agentId: ThreadId
  agentType: string
  intent: string
  group: string | undefined
  spawnedAt: string
  worktree: WorktreeEntryInfo | undefined
  settled?: ChildSettlement | undefined
}

const openChildOf = (spawn: EventOfType<'agent-spawned'>): OpenChild => ({
  agentId: spawn.agentId,
  agentType: spawn.agentType,
  intent: spawn.intent,
  group: spawn.group,
  spawnedAt: spawn.at,
  worktree: spawn.worktree,
})

const settledStatusOf = (status: EAgentStatus): EAgentStatus =>
  status === EAgentStatus.Running ? EAgentStatus.Stopped : status

const settlementOf = (ending: EventOfType<'agent-ended'>): ChildSettlement => ({
  status: settledStatusOf(ending.status),
  endedAt: ending.at,
})

export const openChildrenOf = (events: readonly Event[]): readonly OpenChild[] =>
  unendedSpawns(events).map(openChildOf)

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

const loopEventsOf = (events: readonly V2Event[]): Event[] =>
  events.flatMap((event) => {
    const loop = toLoopEvent({ event })
    return loop === undefined ? [] : [loop]
  })

const threadEventsOf = async (args: {
  plane: ControlPlane
  threadId: ThreadId
  visible: boolean
}): Promise<V2Event[]> => {
  const events: V2Event[] = []
  let afterSeq = 0
  for (;;) {
    const page = await args.plane.readEvents({
      threadId: args.threadId,
      afterSeq,
      limit: READ_LIMIT,
      visible: args.visible,
    })
    events.push(...page.events)
    if (page.next === undefined) return events
    afterSeq = page.next
  }
}

const wasCompacted = (events: readonly V2Event[]): boolean =>
  events.some((event) => event.type === 'history-summarised')

const survivingEventsOf = async (args: {
  record: SessionRecord
  plane: ControlPlane
  threadId: ThreadId
}): Promise<V2Event[]> => {
  const cached = args.record.eventCache().eventsAfter(0)
  const events = wasCompacted(cached)
    ? await threadEventsOf({ plane: args.plane, threadId: args.threadId, visible: false })
    : cached
  const visibility = events.reduce(stepVisibility, EMPTY_VISIBILITY)
  return events.filter((event) => isSurviving(visibility, event))
}

const childOwesEnding = async (args: { plane: ControlPlane; child: OpenChild }): Promise<boolean> =>
  threadEventsOf({ plane: args.plane, threadId: args.child.agentId, visible: true })
    .then((events) => owesEndingOf(loopStateOf({ events: loopEventsOf(events) })))
    .catch(() => true)

const childHasQueued = async (args: {
  plane: ControlPlane
  sessionId: string
  child: OpenChild
}): Promise<boolean> =>
  readThreadInbox({
    plane: args.plane,
    sessionId: args.sessionId,
    threadId: args.child.agentId,
  })
    .then((entries) => entries.length > 0)
    .catch(() => true)

const childWaitsOnInput = async (args: {
  plane: ControlPlane
  sessionId: string
  child: OpenChild
}): Promise<boolean> => {
  try {
    const events = await threadEventsOf({
      plane: args.plane,
      threadId: args.child.agentId,
      visible: true,
    })
    if (events.length === 0) return false
    if (logPendingInputIdsOf(events).length > 0) return true
    return await childHasQueued(args)
  } catch {
    return false
  }
}

const pendingSettlementsOf = async (args: {
  plane: ControlPlane
  sessionId: string
  events: readonly V2Event[]
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

export const openChildren = async (args: {
  record: SessionRecord
  plane: ControlPlane
  sessionId: string
  threadId: ThreadId
}): Promise<readonly OpenChild[]> => {
  const events = await survivingEventsOf(args)
  const children = spawnedChildrenOf(loopEventsOf(events))
  const open = children.filter((child) => child.settled === undefined)
  const pending =
    open.length === 0
      ? new Map<ThreadId, ChildSettlement>()
      : await pendingSettlementsOf({
          plane: args.plane,
          sessionId: args.sessionId,
          events,
        })
  const driveable: OpenChild[] = []
  for (const child of children) {
    const settled = child.settled ?? pending.get(child.agentId)
    if (child.settled === undefined || (await childWaitsOnInput({ ...args, child }))) {
      driveable.push({ ...child, settled })
    }
  }
  return driveable
}

export const childrenAtWorkOf = async (args: {
  plane: ControlPlane
  sessionId: string
  children: readonly OpenChild[]
}): Promise<number> => {
  let atWork = 0
  for (const child of args.children) {
    if (child.settled !== undefined) {
      if (await childWaitsOnInput({ ...args, child })) atWork += 1
      continue
    }
    const queued = await childHasQueued({ ...args, child })
    if (queued || (await childOwesEnding({ plane: args.plane, child }))) atWork += 1
  }
  return atWork
}
