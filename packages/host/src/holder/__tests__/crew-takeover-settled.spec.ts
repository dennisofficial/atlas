import { describe, expect, it } from 'bun:test'

import {
  EAgentStart,
  EKilledBy,
  chainEvents,
  toRunId,
  toThreadId,
  type ThreadId,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const CHILD = toThreadId('thread-child-settled')
const BRIEF = 'SETTLED-BRIEF read the thing'
const ANSWER = 'SETTLED-CHILD finished the thing'
const AT = new Date(0).toISOString()

type Rig = Awaited<ReturnType<typeof makeRig>>

const SPAWN: V2Body = {
  type: 'agent-spawned',
  agentId: CHILD,
  agentType: 'general-purpose',
  intent: 'settled',
  mode: EAgentStart.Fresh,
}

const FINISHED_CHILD: readonly V2Body[] = [
  { type: 'user-said', text: BRIEF },
  { type: 'assistant-said', parts: [{ type: 'text', text: ANSWER }] },
]

const RESUMABLE_CHILD: readonly V2Body[] = [{ type: 'user-said', text: BRIEF }]

const IDLE_CHILD: readonly V2Body[] = [
  { type: 'worktree-entered', path: '/work/tree', branch: 'dennis/tree', adopted: false },
]

const eventsIn = async (args: { rig: Rig; threadId: ThreadId }): Promise<V2Event[]> => {
  const events: V2Event[] = []
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

const endingsOf = (args: { events: readonly V2Event[]; threadId: ThreadId }): V2Event[] =>
  args.events.filter((event) => event.type === 'agent-ended' && event.agentId === args.threadId)

const ofType = (args: { events: readonly V2Event[]; type: string }): V2Event[] =>
  args.events.filter((event) => event.type === args.type)

const parentEndings = async (rig: Rig): Promise<V2Event[]> =>
  endingsOf({ events: await eventsIn({ rig, threadId: THREAD_ID }), threadId: CHILD })

const appendSeeded = async (args: {
  rig: Rig
  threadId: ThreadId
  epoch: number
  bodies: readonly V2Body[]
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

const seedTakeover = async (args: {
  child: readonly V2Body[]
  script?: readonly { text: string }[] | undefined
}): Promise<Rig> => {
  const rig = await makeRig({
    script: args.script ?? [{ text: 'parent acknowledged' }],
  })
  await seedSession(rig)
  const lease = await rig.plane.grant({ sessionId: SESSION, hostId: 1 })
  await rig.plane.createThread({ threadId: CHILD, sessionId: SESSION })
  await appendSeeded({ rig, threadId: THREAD_ID, epoch: lease.epoch, bodies: [SPAWN] })
  await appendSeeded({ rig, threadId: CHILD, epoch: lease.epoch, bodies: args.child })
  await rig.plane.revoke({ sessionId: SESSION, wantsHolder: true })
  await rig.holder.start()
  await rig.wake()
  return rig
}

const waitFor = (args: {
  rig: Rig
  check(): Promise<boolean> | boolean
  attempts?: number
  advanceMs?: number
}): Promise<boolean> =>
  flushUntil({
    check: args.check,
    attempts: args.attempts ?? 200,
    clock: args.rig.clock,
    advanceMs: args.advanceMs ?? 2_000,
  })

const takeOver = async (first: Rig): Promise<Rig> => {
  await first.holder.discard()
  first.presence.lose()
  const next = await makeRig({
    plane: first.plane,
    store: first.store,
    bus: first.bus,
    clock: first.clock,
    daemon: first.daemon,
    script: [{ text: 'parent acknowledged' }],
  })
  await next.holder.start()
  await next.bus.wake(SESSION)
  return next
}

describe('a takeover over a child that already finished its turn', () => {
  it('appends one finished ending with its real prose and restarts nothing', async () => {
    const rig = await seedTakeover({ child: FINISHED_CHILD })

    const ended = await waitFor({ rig, check: async () => (await parentEndings(rig)).length > 0 })
    expect(ended).toBe(true)

    const parent = await eventsIn({ rig, threadId: THREAD_ID })
    expect(endingsOf({ events: parent, threadId: CHILD })).toMatchObject([
      { status: 'finished', prose: ANSWER, turns: 1, toolCalls: 0 },
    ])
    expect(parent).not.toContainEqual(
      expect.objectContaining({
        type: 'agent-ended',
        agentId: CHILD,
        killedBy: EKilledBy.Unrecorded,
      }),
    )
    expect(ofType({ events: parent, type: 'agent-restarted' })).toEqual([])
    expect(
      endingsOf({ events: await eventsIn({ rig, threadId: CHILD }), threadId: CHILD }),
    ).toEqual([])

    const released = await waitFor({
      rig,
      check: () => rig.holder.heldIds().length === 0,
      advanceMs: 5_000,
    })
    expect(released).toBe(true)
    expect((await parentEndings(rig)).length).toBe(1)
  }, 20_000)
})

describe('a session end with an adopted child that never got going', () => {
  it('stops it once with a session-end ending', async () => {
    const rig = await seedTakeover({ child: IDLE_CHILD })

    expect(await waitFor({ rig, check: () => rig.runtimes.length > 0 })).toBe(true)

    const ended = await waitFor({
      rig,
      check: async () => (await parentEndings(rig)).length > 0,
      advanceMs: 5_000,
    })
    expect(ended).toBe(true)
    expect(await parentEndings(rig)).toMatchObject([
      { status: 'stopped', killedBy: EKilledBy.SessionEnd, prose: '' },
    ])
    expect(await waitFor({ rig, check: () => rig.holder.heldIds().length === 0 })).toBe(true)
    expect((await parentEndings(rig)).length).toBe(1)
  }, 20_000)
})

const isFinalAnswer = (events: readonly unknown[]): boolean =>
  events.some((event) => (event as { type?: string }).type === 'assistant-said')

const drainOnFinalAppend = (args: { rig: Rig; state: { drained: boolean } }): void => {
  const append = args.rig.plane.append.bind(args.rig.plane)
  args.rig.plane.append = async (params: Parameters<typeof append>[0]) => {
    const outcome = await append(params)
    if (args.state.drained || params.threadId !== CHILD) return outcome
    if (!isFinalAnswer(params.events)) return outcome
    args.state.drained = true
    await args.rig.holder.drain()
    return outcome
  }
}

describe('a drain that lands between a child final message and its ending', () => {
  it('wants a holder after the drain, which ends the child once', async () => {
    const rig = await seedTakeover({ child: RESUMABLE_CHILD, script: [{ text: ANSWER }] })
    const state = { drained: false }
    drainOnFinalAppend({ rig, state })

    const answered = await waitFor({
      rig,
      check: () => state.drained,
      advanceMs: 5_000,
    })
    expect(answered).toBe(true)
    await rig.flush()

    const child = await eventsIn({ rig, threadId: CHILD })
    expect(ofType({ events: child, type: 'assistant-said' })).toMatchObject([
      { parts: [{ type: 'text', text: ANSWER }] },
    ])
    expect(await parentEndings(rig)).toEqual([])
    const drainedParent = await eventsIn({ rig, threadId: THREAD_ID })
    expect(ofType({ events: drainedParent, type: 'agent-restarted' })).toMatchObject([
      { agentId: CHILD, via: 'relocation' },
    ])

    const drained = await rig.plane.currentLease({ sessionId: SESSION })
    expect(drained.lease.wantsHolder).toBe(true)
    const next = await takeOver(rig)
    const resumed = await waitFor({
      rig: next,
      check: async () => (await parentEndings(next)).length > 0,
      advanceMs: 5_000,
    })
    expect(resumed).toBe(true)

    const settled = await eventsIn({ rig: next, threadId: THREAD_ID })
    expect(endingsOf({ events: settled, threadId: CHILD })).toMatchObject([
      { status: 'finished', prose: ANSWER },
    ])
    expect(endingsOf({ events: settled, threadId: CHILD }).length).toBe(1)
    expect(ofType({ events: settled, type: 'agent-restarted' }).length).toBe(1)
    const ending = settled.find((event) => event.type === 'agent-ended' && event.agentId === CHILD)
    const repliesAfterEnding = settled.filter(
      (event) =>
        event.type === 'assistant-said' && event.seq > (ending?.seq ?? Number.MAX_SAFE_INTEGER),
    )
    expect(repliesAfterEnding.length).toBe(1)
    const held = await next.plane.currentLease({ sessionId: SESSION })
    expect(held.lease.epoch).toBeGreaterThan(drained.lease.epoch)
    expect(held.lease.wantsHolder).toBe(false)

    const released = await waitFor({
      rig: next,
      check: () => next.holder.heldIds().length === 0,
      advanceMs: 5_000,
    })
    expect(released).toBe(true)
    const { lease } = await next.plane.currentLease({ sessionId: SESSION })
    expect(lease.wantsHolder).toBe(false)
  }, 25_000)
})
