import { describe, expect, it } from 'bun:test'

import {
  EAgentStart,
  EAgentStatus,
  chainEvents,
  toRunId,
  toThreadId,
  type InboxEntry,
  type RecordEvent,
  type RecordEventBody,
  type ThreadId,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'

import type { SessionRecord } from '../../record/record-adapter'
import { childrenAtWorkOf, loopEventsOf } from '../child-reads'
import { openChildren, spawnedChildrenOf } from '../open-children'

const SESSION = 'session-1'
const PARENT = toThreadId('thread-parent')
const AT = '2026-11-25T00:00:00.000Z'
const SETTLED = Array.from({ length: 20 }, (_, index) => toThreadId(`brn_settled_${index}`))
const RUNNING = toThreadId('brn_running')
const MESSAGED = SETTLED[19] ?? toThreadId('brn_missing')

const eventsOf = (threadId: ThreadId, bodies: readonly RecordEventBody[]): RecordEvent[] =>
  chainEvents({ threadId, runId: toRunId('run-seed'), epoch: 1, at: AT, bodies })

const spawned = (agentId: ThreadId): RecordEventBody => ({
  type: 'agent-spawned',
  agentId,
  agentType: 'builder',
  intent: 'build it',
  mode: EAgentStart.Fresh,
})

const ended = (agentId: ThreadId): RecordEventBody => ({
  type: 'agent-ended',
  agentId,
  agentType: 'builder',
  intent: 'build it',
  status: EAgentStatus.Finished,
  prose: 'done',
  turns: 1,
  toolCalls: 1,
})

const PARENT_LOG = eventsOf(PARENT, [
  spawned(RUNNING),
  ...SETTLED.flatMap((agentId) => [spawned(agentId), ended(agentId)]),
])

const CHILD_LOG = (threadId: ThreadId): RecordEvent[] =>
  eventsOf(threadId, [
    { type: 'user-said', text: 'build it' },
    { type: 'input-consumed', inboxId: 1 },
  ])

const QUEUED_MESSAGE: InboxEntry = {
  sessionId: SESSION,
  postedAt: AT,
  consumedSeq: null,
  senderSessionId: null,
  inboxId: 2,
  kind: 'message',
  threadId: MESSAGED,
  payload: JSON.stringify({ text: 'carry on' }),
}

const countingPlane = () => {
  const reads = { inFlight: 0, peak: 0 }
  const plane = {
    readEvents: async (args: { threadId: ThreadId; afterSeq: number }) => {
      reads.inFlight += 1
      reads.peak = Math.max(reads.peak, reads.inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      reads.inFlight -= 1
      return { events: CHILD_LOG(args.threadId).filter((event) => event.seq > args.afterSeq) }
    },
    readInbox: async (args: { afterId: number; forThread: ThreadId | null }) =>
      [QUEUED_MESSAGE].filter(
        (entry) => entry.inboxId > args.afterId && entry.threadId === args.forThread,
      ),
  } as unknown as ControlPlane
  return { plane, reads }
}

const record = { eventCache: () => ({ eventsAfter: () => PARENT_LOG }) } as unknown as SessionRecord

describe('a takeover over a session with many settled sub-agents', () => {
  it('checks the settled sub-agents for waiting input concurrently, up to the read limit', async () => {
    const { plane, reads } = countingPlane()

    await openChildren({ record, plane, sessionId: SESSION, threadId: PARENT })

    expect(reads.peak).toBeGreaterThan(1)
    expect(reads.peak).toBeLessThanOrEqual(8)
  })

  it('keeps the running sub-agent and the messaged one, in spawn order', async () => {
    const { plane } = countingPlane()

    const children = await openChildren({ record, plane, sessionId: SESSION, threadId: PARENT })

    expect(children.map((child) => child.agentId)).toEqual([RUNNING, MESSAGED])
  })

  it('counts the sub-agents at work with concurrent reads', async () => {
    const { plane, reads } = countingPlane()

    const atWork = await childrenAtWorkOf({
      plane,
      sessionId: SESSION,
      children: spawnedChildrenOf(loopEventsOf(PARENT_LOG)),
    })

    expect(atWork).toBe(2)
    expect(reads.peak).toBeGreaterThan(1)
    expect(reads.peak).toBeLessThanOrEqual(8)
  })
})
