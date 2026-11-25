import {
  loopStateOf,
  owesEndingOf,
  toLoopEvent,
  type Event,
  type RecordEvent,
  type ThreadId,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'

import { logPendingInputIdsOf, readThreadInbox } from '../held-inbox'
import type { OpenChild } from './open-children'
import { pooledMap } from './pooled-map'

const READ_LIMIT = 1000
export const CHILD_READ_CONCURRENCY = 8

export const loopEventsOf = (events: readonly RecordEvent[]): Event[] =>
  events.flatMap((event) => {
    const loop = toLoopEvent({ event })
    return loop === undefined ? [] : [loop]
  })

export const threadEventsOf = async (args: {
  plane: ControlPlane
  threadId: ThreadId
  visible: boolean
}): Promise<RecordEvent[]> => {
  const events: RecordEvent[] = []
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

export const childWaitsOnInput = async (args: {
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

export const childrenAtWorkOf = async (args: {
  plane: ControlPlane
  sessionId: string
  children: readonly OpenChild[]
}): Promise<number> => {
  const working = await pooledMap({
    items: args.children,
    limit: CHILD_READ_CONCURRENCY,
    work: (child) => childAtWork({ ...args, child }),
  })
  return working.filter(Boolean).length
}

const childAtWork = async (args: {
  plane: ControlPlane
  sessionId: string
  child: OpenChild
}): Promise<boolean> => {
  if (args.child.settled !== undefined) return childWaitsOnInput(args)
  if (await childHasQueued(args)) return true
  return childOwesEnding(args)
}
