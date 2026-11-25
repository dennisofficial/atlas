import { describe, expect, it } from 'bun:test'

import {
  EAgentStart,
  EAgentStatus,
  chainEvents,
  toRunId,
  toThreadId,
  type ThreadId,
  type RecordEventBody,
  type RecordEvent,
} from '@dltech/atlas-core'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'

import { messagePayloadOf } from '../crew/child-reports'
import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const CHILD = toThreadId('thread-child-queue')
const BRIEF = 'QUEUED-BRIEF read the thing'
const ANSWER = 'QUEUED-CHILD finished the thing'
const LATE = 'QUEUED-LATE one more thing'
const SECOND_ANSWER = 'QUEUED-CHILD answered the late message'
const FIRST_INBOX = 1000
const AT = new Date(0).toISOString()

type Rig = Awaited<ReturnType<typeof makeRig>>

const spawned: RecordEventBody = {
  type: 'agent-spawned',
  agentId: CHILD,
  agentType: 'general-purpose',
  intent: 'queued',
  mode: EAgentStart.Fresh,
}

const ended: RecordEventBody = {
  type: 'agent-ended',
  agentId: CHILD,
  agentType: 'general-purpose',
  intent: 'queued',
  status: EAgentStatus.Finished,
  prose: ANSWER,
  turns: 1,
  toolCalls: 0,
}

const firstTurn: readonly RecordEventBody[] = [
  { type: 'user-said', inboxId: FIRST_INBOX, requestId: `inbox:${FIRST_INBOX}`, text: BRIEF },
  { type: 'assistant-said', parts: [{ type: 'text', text: ANSWER }] },
]

const eventsIn = async (args: { rig: Rig; threadId: ThreadId }): Promise<RecordEvent[]> => {
  const events: RecordEvent[] = []
  let afterSeq = 0
  for (;;) {
    const page = await args.rig.plane.readEvents({
      threadId: args.threadId,
      afterSeq,
      limit: 1000,
      visible: false,
    })
    events.push(...page.events)
    if (page.next === undefined) return events
    afterSeq = page.next
  }
}

const appendSeeded = async (args: {
  rig: Rig
  threadId: ThreadId
  epoch: number
  bodies: readonly RecordEventBody[]
}): Promise<void> => {
  const head = await args.rig.plane.head({ threadId: args.threadId })
  const outcome = await args.rig.plane.append({
    threadId: args.threadId,
    epoch: args.epoch,
    events: chainEvents({
      threadId: args.threadId,
      runId: toRunId('seed-run'),
      epoch: args.epoch,
      from: head,
      at: AT,
      bodies: args.bodies,
    }),
  })
  if (!outcome.ok) throw new Error(`seed refused: ${JSON.stringify(outcome.refusal)}`)
}

const textsOf = (args: {
  events: readonly RecordEvent[]
  type: 'user-said' | 'assistant-said'
}): string[] =>
  args.events.flatMap((event) => {
    if (event.type === 'user-said') return args.type === 'user-said' ? [event.text] : []
    if (event.type !== 'assistant-said') return []
    return args.type === 'assistant-said'
      ? event.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []))
      : []
  })

const ofType = (args: {
  events: readonly RecordEvent[]
  type: string
  agentId: string
}): RecordEvent[] =>
  args.events.filter(
    (event) => event.type === args.type && 'agentId' in event && event.agentId === args.agentId,
  )

const childEndings = async (rig: Rig): Promise<RecordEvent[]> =>
  ofType({
    events: await eventsIn({ rig, threadId: THREAD_ID }),
    type: 'agent-ended',
    agentId: CHILD,
  })

const seedQueue = async (args: { staged: boolean }): Promise<Rig> => {
  const rig = await makeRig({ script: [{ text: SECOND_ANSWER }] })
  await seedSession(rig)
  const lease = await rig.plane.grant({ sessionId: SESSION, hostId: 1 })
  await rig.plane.createThread({ threadId: CHILD, sessionId: SESSION })
  await appendSeeded({ rig, threadId: THREAD_ID, epoch: lease.epoch, bodies: [spawned, ended] })
  await appendSeeded({ rig, threadId: CHILD, epoch: lease.epoch, bodies: firstTurn })
  const row = await rig.plane.post({
    sessionId: SESSION,
    kind: INBOX_KIND_MESSAGE,
    payload: messagePayloadOf({ text: LATE }),
    threadId: CHILD,
  })
  if (args.staged) {
    await appendSeeded({
      rig,
      threadId: CHILD,
      epoch: lease.epoch,
      bodies: [
        {
          type: 'input-posted',
          inboxId: row.inboxId,
          kind: INBOX_KIND_MESSAGE,
          postedAt: AT,
          message: { text: LATE },
        },
      ],
    })
  }
  await rig.plane.revoke({ sessionId: SESSION, wantsHolder: true })
  await rig.holder.start()
  await rig.wake()
  return rig
}

const untilAnswered = async (args: { rig: Rig; count: number }): Promise<boolean> =>
  flushUntil({
    check: async () =>
      textsOf({
        events: await eventsIn({ rig: args.rig, threadId: CHILD }),
        type: 'assistant-said',
      }).length === args.count,
    attempts: 400,
    clock: args.rig.clock,
    advanceMs: 5_000,
  })

const untilSecondEnding = async (rig: Rig): Promise<boolean> =>
  flushUntil({
    check: async () => (await childEndings(rig)).length === 2,
    attempts: 400,
    clock: rig.clock,
    advanceMs: 5_000,
  })

describe('a message queued for a child the parent already ended', () => {
  it('takes the child over, answers once, and ends it a second time', async () => {
    const rig = await seedQueue({ staged: false })

    expect(await untilAnswered({ rig, count: 2 })).toBe(true)
    expect(await untilSecondEnding(rig)).toBe(true)

    const child = await eventsIn({ rig, threadId: CHILD })
    expect(textsOf({ events: child, type: 'user-said' })).toEqual([BRIEF, LATE])
    expect(textsOf({ events: child, type: 'assistant-said' })).toEqual([ANSWER, SECOND_ANSWER])

    const parent = await eventsIn({ rig, threadId: THREAD_ID })
    expect(await childEndings(rig)).toHaveLength(2)
    expect(ofType({ events: parent, type: 'agent-ended', agentId: CHILD })).toMatchObject([
      { prose: ANSWER },
      { prose: SECOND_ANSWER },
    ])
    expect(ofType({ events: parent, type: 'agent-restarted', agentId: CHILD })).toHaveLength(1)
  }, 25_000)

  it('takes the child over when the row was staged before the handoff', async () => {
    const rig = await seedQueue({ staged: true })

    expect(await untilAnswered({ rig, count: 2 })).toBe(true)
    expect(await untilSecondEnding(rig)).toBe(true)

    const child = await eventsIn({ rig, threadId: CHILD })
    expect(textsOf({ events: child, type: 'user-said' })).toEqual([BRIEF, LATE])
    expect(
      child.filter((event) => event.type === 'input-posted' && event.message?.text === LATE),
    ).toHaveLength(1)
    expect(
      await rig.plane.readInbox({
        sessionId: SESSION,
        afterId: 0,
        limit: 200,
        forThread: CHILD,
      }),
    ).toEqual([])

    const parent = await eventsIn({ rig, threadId: THREAD_ID })
    expect(ofType({ events: parent, type: 'agent-ended', agentId: CHILD })).toHaveLength(2)
    expect(ofType({ events: parent, type: 'agent-restarted', agentId: CHILD })).toHaveLength(1)
  }, 25_000)
})
