import { describe, expect, it } from 'bun:test'

import {
  EAgentRestart,
  EAgentStart,
  EAgentStatus,
  ECompactionAnchor,
  chainEvents,
  toCallId,
  visibleEvents,
  toRunId,
  toThreadId,
  type ThreadId,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'

import type { SessionRecord } from '../../record/record-adapter'
import { openChildren } from '../open-children'

const PARENT = toThreadId('thread-parent')
const FIRST = toThreadId('thread-child-1')
const SECOND = toThreadId('thread-child-2')
const REWOUND = toThreadId('thread-child-3')
const AT = '2026-01-01T00:00:00.000Z'
const GROUP = 'call-1'

const spawned = (agentId: ThreadId, group: string): V2Body => ({
  type: 'agent-spawned',
  agentId,
  agentType: 'builder',
  intent: 'build it',
  mode: EAgentStart.Fresh,
  group,
})

const endedBody = (agentId: ThreadId): V2Body => ({
  type: 'agent-ended',
  agentId,
  agentType: 'builder',
  intent: 'build it',
  status: EAgentStatus.Finished,
  prose: 'done',
  turns: 1,
  toolCalls: 2,
})

const summarised = (args: { fromSeq: number; throughSeq: number }): V2Body => ({
  type: 'history-summarised',
  fromSeq: args.fromSeq,
  throughSeq: args.throughSeq,
  anchor: ECompactionAnchor.Prefix,
  summary: 'the spawn rows are behind the compaction watermark',
})

const planeOf = (events: readonly V2Event[], childEvents: readonly V2Event[] = []): ControlPlane =>
  ({
    readEvents: async (args: {
      threadId: ThreadId
      afterSeq: number
      limit: number
      visible: boolean
    }) => {
      const source = args.threadId === PARENT ? events : childEvents
      const kept = args.visible ? visibleEvents(source) : source
      const page = kept.filter((event) => event.seq > args.afterSeq).slice(0, args.limit)
      return { events: page }
    },
    readInbox: async () => [],
    readInboxEntry: async () => undefined,
    endTerminals: async () => 0,
  }) as unknown as ControlPlane

const cacheOf = (events: readonly V2Event[]): SessionRecord => {
  const visible = new Set(visibleEvents(events))
  const cached = events.filter((event) => visible.has(event) || event.type === 'history-summarised')
  return {
    eventCache: () => ({ eventsAfter: () => cached }),
  } as unknown as SessionRecord
}

const openOver = (bodies: readonly V2Body[], childBodies: readonly V2Body[] = []) => {
  const events = chainEvents({
    threadId: PARENT,
    runId: toRunId('run-seed'),
    epoch: 1,
    at: AT,
    bodies,
  })
  const childEvents =
    childBodies.length === 0
      ? []
      : chainEvents({
          threadId: FIRST,
          runId: toRunId('run-child'),
          epoch: 1,
          at: AT,
          bodies: childBodies,
        })
  return openChildren({
    record: cacheOf(events),
    plane: planeOf(events, childEvents),
    sessionId: 'session-1',
    threadId: PARENT,
  })
}

describe('a takeover whose parent log was compacted', () => {
  it('adopts every child the compaction hid, with its group intact', async () => {
    const children = await openOver([
      spawned(FIRST, GROUP),
      spawned(SECOND, GROUP),
      summarised({ fromSeq: 1, throughSeq: 2 }),
    ])

    expect(children.map((child) => child.agentId)).toEqual([FIRST, SECOND])
    expect(children.map((child) => child.group)).toEqual([GROUP, GROUP])
  })

  it('leaves a spawn behind a rewind out, even though the compaction hid the rows around it', async () => {
    const children = await openOver([
      spawned(FIRST, GROUP),
      spawned(REWOUND, GROUP),
      summarised({ fromSeq: 1, throughSeq: 1 }),
      { type: 'history-rewound', toSeq: 1 },
    ])

    expect(children.map((child) => child.agentId)).toEqual([FIRST])
  })

  it('still honours a clean ending the compaction hid', async () => {
    const children = await openOver([
      spawned(FIRST, GROUP),
      endedBody(FIRST),
      summarised({ fromSeq: 1, throughSeq: 2 }),
    ])

    expect(children).toEqual([])
  })
})

describe('a child that was restarted after its ending', () => {
  const restartBody = (agentId: ThreadId): V2Body => ({
    type: 'agent-restarted',
    agentId,
    agentType: 'builder',
    intent: 'build it',
    via: EAgentRestart.Message,
  })

  const childLog: readonly V2Body[] = [
    { type: 'user-said', text: 'go on' },
    { type: 'input-consumed', inboxId: 12 },
    {
      type: 'tool-called',
      callId: toCallId('call-1'),
      name: 'bash',
      input: { command: 'sleep 1' },
      ordinal: 0,
    },
  ]

  it('adopts the restarted child even though its earlier ending is in the log', async () => {
    const children = await openOver(
      [spawned(FIRST, GROUP), endedBody(FIRST), restartBody(FIRST)],
      childLog,
    )

    expect(children.map((child) => child.agentId)).toEqual([FIRST])
    expect(children[0]?.settled).toBeUndefined()
  })

  it('settles a restarted child that has ended again, so no later takeover adopts it', async () => {
    const children = await openOver(
      [spawned(FIRST, GROUP), endedBody(FIRST), restartBody(FIRST), endedBody(FIRST)],
      childLog,
    )

    expect(children).toEqual([])
  })
})
