import { describe, expect, it } from 'bun:test'

import {
  EAgentStart,
  EAgentStatus,
  EKilledBy,
  INBOX_KIND_EVENT,
  chainEvents,
  inboxEventPayloadOf,
  toRunId,
  toThreadId,
  type InboxEntry,
  type ThreadId,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'

import type { SessionRecord } from '../../record/record-adapter'
import { openChildren } from '../open-children'

const SESSION = 'session-1'
const PARENT = toThreadId('thread-parent')
const CHILD = toThreadId('brn_child')
const AT = '2026-11-25T00:41:05.000Z'

const eventsOf = (threadId: ThreadId, bodies: readonly V2Body[]): V2Event[] =>
  chainEvents({ threadId, runId: toRunId('run-seed'), epoch: 1, at: AT, bodies })

const PARENT_LOG = eventsOf(PARENT, [
  {
    type: 'agent-spawned',
    agentId: CHILD,
    agentType: 'builder',
    intent: 'fix the seed',
    mode: EAgentStart.Fresh,
  },
])

const INTERRUPTED_CHILD_LOG = eventsOf(CHILD, [
  { type: 'user-said', text: 'fix the seed' },
  { type: 'input-consumed', inboxId: 1 },
])

const entryOf = (args: {
  inboxId: number
  kind: string
  payload: string
  threadId: ThreadId | null
}): InboxEntry => ({
  sessionId: SESSION,
  postedAt: AT,
  consumedSeq: null,
  senderSessionId: null,
  ...args,
})

const PENDING_ENDING = entryOf({
  inboxId: 126,
  kind: INBOX_KIND_EVENT,
  threadId: null,
  payload: inboxEventPayloadOf({
    event: {
      type: 'agent-ended',
      agentId: CHILD,
      agentType: 'builder',
      intent: 'fix the seed',
      status: EAgentStatus.Stopped,
      killedBy: EKilledBy.SessionEnd,
      prose: '',
      turns: 44,
      toolCalls: 90,
    },
    clientId: `agent-ended:${CHILD}:285`,
  }),
})

const QUEUED_MESSAGE = entryOf({
  inboxId: 127,
  kind: 'message',
  threadId: CHILD,
  payload: JSON.stringify({ text: 'carry on' }),
})

const planeOf = (inbox: readonly InboxEntry[]): ControlPlane =>
  ({
    readEvents: async (args: { threadId: ThreadId; afterSeq: number }) => {
      const source = args.threadId === PARENT ? PARENT_LOG : INTERRUPTED_CHILD_LOG
      return { events: source.filter((event) => event.seq > args.afterSeq) }
    },
    readInbox: async (args: { afterId: number; forThread: ThreadId | null }) =>
      inbox.filter(
        (entry) =>
          entry.inboxId > args.afterId &&
          (args.forThread === null ? entry.threadId === null : entry.threadId === args.forThread),
      ),
  }) as unknown as ControlPlane

const openWith = (inbox: readonly InboxEntry[]) =>
  openChildren({
    record: { eventCache: () => ({ eventsAfter: () => PARENT_LOG }) } as unknown as SessionRecord,
    plane: planeOf(inbox),
    sessionId: SESSION,
    threadId: PARENT,
  })

describe('a takeover over an interrupted child whose ending waits in the inbox', () => {
  it('adopts it settled and idle, so the wake does not restart it only to stop it again', async () => {
    const children = await openWith([PENDING_ENDING])

    expect(children).toMatchObject([
      { agentId: CHILD, settled: { status: EAgentStatus.Stopped }, keepIdle: true },
    ])
  })

  it('still drives it when a message waits for it', async () => {
    const children = await openWith([PENDING_ENDING, QUEUED_MESSAGE])

    expect(children).toMatchObject([{ agentId: CHILD, keepIdle: false }])
  })

  it('drives it as before when no ending was posted for it', async () => {
    const children = await openWith([])

    expect(children).toMatchObject([{ agentId: CHILD }])
    expect(children[0]?.settled).toBeUndefined()
    expect(children[0]?.keepIdle).toBeUndefined()
  })
})
