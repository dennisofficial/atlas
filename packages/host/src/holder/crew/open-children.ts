import {
  finishedTurnOf,
  loopStateOf,
  toLoopEvent,
  unendedSpawns,
  type Event,
  type ThreadId,
  type V2Event,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { WorktreeEntryInfo } from '@dltech/atlas-plugin-sdk'

import type { SessionRecord } from '../record/record-adapter'

const READ_LIMIT = 1000

export type OpenChild = {
  agentId: ThreadId
  agentType: string
  intent: string
  spawnedAt: string
  worktree: WorktreeEntryInfo | undefined
}

export const openChildrenOf = (events: readonly Event[]): readonly OpenChild[] =>
  unendedSpawns(events).map((spawn) => ({
    agentId: spawn.agentId,
    agentType: spawn.agentType,
    intent: spawn.intent,
    spawnedAt: spawn.at,
    worktree: spawn.worktree,
  }))

export const openChildren = async (args: {
  record: SessionRecord
  threadId: ThreadId
}): Promise<readonly OpenChild[]> =>
  openChildrenOf(await args.record.ownEvents({ threadId: args.threadId }))

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

export const childrenAtWorkOf = async (args: {
  plane: ControlPlane
  children: readonly OpenChild[]
}): Promise<number> => {
  let atWork = 0
  for (const child of args.children) {
    const events = await threadEventsOf({ plane: args.plane, threadId: child.agentId }).catch(
      () => [],
    )
    if (!finishedTurnOf(loopStateOf({ events: loopEventsOf(events) }))) atWork += 1
  }
  return atWork
}
