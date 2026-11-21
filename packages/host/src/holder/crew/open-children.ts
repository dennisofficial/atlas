import {
  agentLifecycleKind,
  agentRoster,
  EAgentStatus,
  lifecycleOf,
  loopStateOf,
  owesEndingOf,
  toLoopEvent,
  unendedSpawns,
  type Event,
  type EventOfType,
  type ThreadId,
  type V2Event,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { WorktreeEntryInfo } from '@dltech/atlas-plugin-sdk'

import { logPendingInputIdsOf, readThreadInbox } from '../held-inbox'
import type { SessionRecord } from '../record/record-adapter'

const READ_LIMIT = 1000

export type ChildSettlement = { status: EAgentStatus; endedAt: string }

export type OpenChild = {
  agentId: ThreadId
  agentType: string
  intent: string
  spawnedAt: string
  worktree: WorktreeEntryInfo | undefined
  settled?: ChildSettlement | undefined
}

const openChildOf = (spawn: EventOfType<'agent-spawned'>): OpenChild => ({
  agentId: spawn.agentId,
  agentType: spawn.agentType,
  intent: spawn.intent,
  spawnedAt: spawn.at,
  worktree: spawn.worktree,
})

const settlementOf = (ending: EventOfType<'agent-ended'>): ChildSettlement => ({
  status: ending.status === EAgentStatus.Running ? EAgentStatus.Stopped : ending.status,
  endedAt: ending.at,
})

export const openChildrenOf = (events: readonly Event[]): readonly OpenChild[] =>
  unendedSpawns(events).map(openChildOf)

export const spawnedChildrenOf = (events: readonly Event[]): readonly OpenChild[] => {
  const byAgent = new Map<ThreadId, OpenChild>()
  for (const lifecycle of lifecycleOf(events, agentLifecycleKind)) {
    byAgent.set(lifecycle.key as ThreadId, {
      ...openChildOf(lifecycle.started),
      ...(lifecycle.ending === undefined ? {} : { settled: settlementOf(lifecycle.ending) }),
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
}): Promise<V2Event[]> => {
  const events: V2Event[] = []
  let afterSeq = 0
  for (;;) {
    const page = await args.plane.readEvents({
      threadId: args.threadId,
      afterSeq,
      limit: READ_LIMIT,
      visible: true,
    })
    events.push(...page.events)
    if (page.next === undefined) return events
    afterSeq = page.next
  }
}

const childOwesEnding = async (args: { plane: ControlPlane; child: OpenChild }): Promise<boolean> =>
  threadEventsOf({ plane: args.plane, threadId: args.child.agentId })
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
    const events = await threadEventsOf({ plane: args.plane, threadId: args.child.agentId })
    if (events.length === 0) return false
    if (logPendingInputIdsOf(events).length > 0) return true
    return await childHasQueued(args)
  } catch {
    return false
  }
}

export const openChildren = async (args: {
  record: SessionRecord
  plane: ControlPlane
  sessionId: string
  threadId: ThreadId
}): Promise<readonly OpenChild[]> => {
  const driveable: OpenChild[] = []
  for (const child of spawnedChildrenOf(await args.record.ownEvents({ threadId: args.threadId }))) {
    if (child.settled === undefined || (await childWaitsOnInput({ ...args, child }))) {
      driveable.push(child)
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
