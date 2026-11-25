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
  type ThreadId,
  type RecordEventBody,
  type RecordEvent,
} from '@dltech/atlas-core'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const CHILD = toThreadId('thread-child-pending')
const BRIEF = 'PENDING-BRIEF read the thing'
const ANSWER = 'PENDING-CHILD finished the thing'
const AT = new Date(0).toISOString()

type Rig = Awaited<ReturnType<typeof makeRig>>

const SPAWN: RecordEventBody = {
  type: 'agent-spawned',
  agentId: CHILD,
  agentType: 'general-purpose',
  intent: 'pending ending',
  mode: EAgentStart.Fresh,
}

const CHILD_LOG: readonly RecordEventBody[] = [
  { type: 'user-said', text: BRIEF },
  { type: 'assistant-said', parts: [{ type: 'text', text: ANSWER }] },
  { type: 'input-consumed', inboxId: 91 },
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

const endingsOf = (events: readonly RecordEvent[]): RecordEvent[] =>
  events.filter((event) => event.type === 'agent-ended' && event.agentId === CHILD)

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

const INTERRUPTED_LOG: readonly RecordEventBody[] = [
  { type: 'user-said', text: BRIEF },
  { type: 'input-consumed', inboxId: 91 },
]

const postPendingEnding = async (args: {
  rig: Rig
  seq: number
  status?: EAgentStatus
}): Promise<void> => {
  await args.rig.plane.post({
    sessionId: SESSION,
    kind: INBOX_KIND_EVENT,
    payload: inboxEventPayloadOf({
      event: {
        type: 'agent-ended',
        agentId: CHILD,
        agentType: 'general-purpose',
        intent: 'pending ending',
        status: args.status ?? EAgentStatus.Finished,
        ...(args.status === EAgentStatus.Stopped ? { killedBy: EKilledBy.SessionEnd } : {}),
        prose: ANSWER,
        turns: 1,
        toolCalls: 0,
      },
      clientId: `agent-ended:${CHILD}:${args.seq}`,
    }),
  })
}

const waitFor = (args: { rig: Rig; check(): Promise<boolean> | boolean; attempts?: number }) =>
  flushUntil({
    check: args.check,
    attempts: args.attempts ?? 200,
    clock: args.rig.clock,
    advanceMs: 2_000,
  })

describe('a takeover over a child whose ending is still in the inbox', () => {
  it('keeps the one ending the old host posted and appends no second one', async () => {
    const rig = await makeRig({ script: [{ text: 'parent acknowledged' }] })
    await seedSession(rig)
    const lease = await rig.plane.grant({ sessionId: SESSION, hostId: 1 })
    await rig.plane.createThread({ threadId: CHILD, sessionId: SESSION })
    await appendSeeded({ rig, threadId: THREAD_ID, epoch: lease.epoch, bodies: [SPAWN] })
    await appendSeeded({ rig, threadId: CHILD, epoch: lease.epoch, bodies: CHILD_LOG })
    await postPendingEnding({ rig, seq: 2 })
    await rig.plane.revoke({ sessionId: SESSION, wantsHolder: true })
    await rig.holder.start()
    await rig.wake()

    const drained = await waitFor({
      rig,
      check: async () => endingsOf(await eventsIn({ rig, threadId: THREAD_ID })).length > 0,
    })
    expect(drained).toBe(true)
    await rig.flush()
    const settled = await waitFor({
      rig,
      check: async () => endingsOf(await eventsIn({ rig, threadId: THREAD_ID })).length > 1,
      attempts: 20,
    })

    expect(settled).toBe(false)
    expect(endingsOf(await eventsIn({ rig, threadId: THREAD_ID }))).toMatchObject([
      { status: EAgentStatus.Finished, prose: ANSWER, turns: 1 },
    ])
  }, 20_000)

  it('leaves an interrupted child stopped instead of restarting it to be stopped again', async () => {
    const rig = await makeRig({ script: [{ text: 'parent acknowledged' }] })
    await seedSession(rig)
    const lease = await rig.plane.grant({ sessionId: SESSION, hostId: 1 })
    await rig.plane.createThread({ threadId: CHILD, sessionId: SESSION })
    await appendSeeded({ rig, threadId: THREAD_ID, epoch: lease.epoch, bodies: [SPAWN] })
    await appendSeeded({ rig, threadId: CHILD, epoch: lease.epoch, bodies: INTERRUPTED_LOG })
    await postPendingEnding({ rig, seq: 2, status: EAgentStatus.Stopped })
    await rig.plane.revoke({ sessionId: SESSION, wantsHolder: true })
    await rig.holder.start()
    await rig.wake()

    const drained = await waitFor({
      rig,
      check: async () => endingsOf(await eventsIn({ rig, threadId: THREAD_ID })).length > 0,
    })
    expect(drained).toBe(true)
    await rig.flush()
    const settled = await waitFor({
      rig,
      check: async () => endingsOf(await eventsIn({ rig, threadId: THREAD_ID })).length > 1,
      attempts: 20,
    })

    const parent = await eventsIn({ rig, threadId: THREAD_ID })
    expect(settled).toBe(false)
    expect(endingsOf(parent)).toMatchObject([
      { status: EAgentStatus.Stopped, killedBy: EKilledBy.SessionEnd },
    ])
    expect(parent.filter((event) => event.type === 'agent-restarted')).toEqual([])
    expect(await eventsIn({ rig, threadId: CHILD })).toHaveLength(INTERRUPTED_LOG.length)
  }, 20_000)
})
