import { describe, expect, it } from 'bun:test'

import {
  EAgentStart,
  EAgentStatus,
  EMessageOrigin,
  chainEvents,
  toRunId,
  toThreadId,
  type RecordEventBody,
  type ThreadId,
} from '@dltech/atlas-core'
import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'

const CHILD = toThreadId('thread-adopted-a')
const CHILDREN = Array.from({ length: 4 }, (_, index) => toThreadId(`thread-adopted-${index}`))
const AT = new Date(0).toISOString()
const PREPARED: readonly RecordEventBody[] = [{ type: 'workspace-prepared' }]
const CHILD_ANSWER = 'adopted child answered'

const appendBodies = async (args: {
  rig: HolderRig
  threadId: ThreadId
  epoch: number
  bodies: readonly RecordEventBody[]
}): Promise<void> => {
  const outcome = await args.rig.plane.append({
    threadId: args.threadId,
    epoch: args.epoch,
    events: chainEvents({
      threadId: args.threadId,
      runId: toRunId('seeded-run'),
      epoch: args.epoch,
      at: AT,
      bodies: args.bodies,
      from: await args.rig.plane.head({ threadId: args.threadId }),
    }),
  })
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
}

const CHILD_BODIES: readonly RecordEventBody[] = [
  { type: 'user-said', text: 'child work' },
  { type: 'assistant-said', parts: [{ type: 'text', text: 'child done' }] },
  { type: 'input-consumed', inboxId: 1 },
]

const spawnOf = (agentId: ThreadId): RecordEventBody => ({
  type: 'agent-spawned',
  agentId,
  agentType: 'general-purpose',
  intent: 'child work',
  mode: EAgentStart.Fresh,
})

const endedOf = (agentId: ThreadId): RecordEventBody => ({
  type: 'agent-ended',
  agentId,
  agentType: 'general-purpose',
  intent: 'child work',
  status: EAgentStatus.Finished,
  prose: 'done',
  turns: 1,
  toolCalls: 1,
})

const leaveDeadHolder = async (args: {
  rig: HolderRig
  children: readonly ThreadId[]
  settled?: boolean | undefined
  parentBodies?: readonly RecordEventBody[] | undefined
}): Promise<void> => {
  const { epoch } = await args.rig.plane.grant({ sessionId: SESSION, hostId: 9001 })
  for (const child of args.children) {
    await args.rig.plane.createThread({ threadId: child, sessionId: SESSION })
    await appendBodies({ rig: args.rig, threadId: child, epoch, bodies: CHILD_BODIES })
  }
  await appendBodies({
    rig: args.rig,
    threadId: THREAD_ID,
    epoch,
    bodies: [
      ...args.children.flatMap((child) =>
        args.settled === true ? [spawnOf(child), endedOf(child)] : [spawnOf(child)],
      ),
      ...(args.parentBodies ?? []),
    ],
  })
  await args.rig.plane.revoke({ sessionId: SESSION, wantsHolder: true })
}

const childReadsOf = (args: {
  rig: HolderRig
  children: readonly ThreadId[]
  gate?: Promise<void> | undefined
}): { started: number; finished: number; peak: number } => {
  const state = { started: 0, finished: 0, inFlight: 0, peak: 0 }
  const read = args.rig.plane.readEvents.bind(args.rig.plane)
  args.rig.plane.readEvents = async (params) => {
    if (!args.children.includes(params.threadId as ThreadId)) return read(params)
    state.started += 1
    state.inFlight += 1
    state.peak = Math.max(state.peak, state.inFlight)
    if (args.gate !== undefined) await args.gate
    state.inFlight -= 1
    state.finished += 1
    return read(params)
  }
  return state
}

const childEventsOf = async (args: {
  rig: HolderRig
  threadId: ThreadId
}): Promise<
  { type: string; inboxId?: number; text?: string; parts?: { type: string; text?: string }[] }[]
> => {
  const page = await args.rig.plane.readEvents({
    threadId: args.threadId,
    afterSeq: 0,
    limit: 1_000,
    visible: false,
  })
  return page.events as never
}

const answersOf = async (rig: HolderRig): Promise<number> =>
  (await childEventsOf({ rig, threadId: CHILD })).filter(
    (event) =>
      event.type === 'assistant-said' &&
      event.parts?.some((part) => part.text === CHILD_ANSWER) === true,
  ).length

const promptsOf = async (rig: HolderRig): Promise<number> =>
  (await childEventsOf({ rig, threadId: CHILD })).filter(
    (event) => event.type === 'user-said' && event.text === 'one more thing',
  ).length

const seedChildQueue = async (rig: HolderRig): Promise<void> => {
  const { epoch } = await rig.plane.grant({ sessionId: SESSION, hostId: 9001 })
  await rig.plane.createThread({ threadId: CHILD, sessionId: SESSION })
  await appendBodies({
    rig,
    threadId: CHILD,
    epoch,
    bodies: [
      { type: 'user-said', inboxId: 1, requestId: 'inbox:1', text: 'child work' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'child done' }] },
    ],
  })
  await rig.plane.post({
    sessionId: SESSION,
    kind: 'message',
    payload: JSON.stringify({ text: 'one more thing', via: EMessageOrigin.PeerAgent }),
    threadId: CHILD,
  })
  await appendBodies({
    rig,
    threadId: THREAD_ID,
    epoch,
    bodies: [{ type: 'workspace-prepared' }, spawnOf(CHILD), endedOf(CHILD)],
  })
  await rig.plane.revoke({ sessionId: SESSION, wantsHolder: true })
}

const hasEvent = async (rig: HolderRig, type: string): Promise<boolean> =>
  (await rig.events()).some((event) => event.type === type)

const wakeWithPrompt = async (rig: HolderRig, text: string): Promise<void> => {
  await rig.holder.start()
  await rig.post(text)
  await rig.wake()
}

describe('a take-over with sub-agents to adopt', () => {
  it('reaches its first step only once the sub-agent records are adopted', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await leaveDeadHolder({ rig, children: [CHILD], parentBodies: PREPARED })
    const gate = Promise.withResolvers<void>()
    const reads = childReadsOf({ rig, children: [CHILD], gate: gate.promise })
    await wakeWithPrompt(rig, 'go')

    expect(await flushUntil({ check: () => reads.started > 0, attempts: 400 })).toBe(true)
    await rig.flush()
    expect(reads.finished).toBe(0)
    expect(await hasEvent(rig, 'turn-started')).toBe(false)

    gate.resolve()

    expect(await flushUntil({ check: () => reads.finished > 0, attempts: 400 })).toBe(true)
    expect(await flushUntil({ check: () => hasEvent(rig, 'turn-started'), attempts: 400 })).toBe(
      true,
    )
    expect(await flushUntil({ check: () => hasEvent(rig, 'assistant-said'), attempts: 400 })).toBe(
      true,
    )
  })

  it('adopts the sub-agents concurrently, up to the read limit', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await leaveDeadHolder({ rig, children: CHILDREN })
    const gate = Promise.withResolvers<void>()
    const reads = childReadsOf({ rig, children: CHILDREN, gate: gate.promise })
    await wakeWithPrompt(rig, 'go')

    expect(
      await flushUntil({ check: () => reads.started === CHILDREN.length, attempts: 600 }),
    ).toBe(true)
    expect(reads.finished).toBe(0)
    expect(reads.peak).toBe(CHILDREN.length)

    gate.resolve()
    expect(
      await flushUntil({ check: () => reads.finished >= CHILDREN.length, attempts: 600 }),
    ).toBe(true)
    expect(reads.peak).toBeLessThanOrEqual(8)
  })

  it('releases the pod when there is nothing to adopt', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await leaveDeadHolder({ rig, children: CHILDREN, settled: true, parentBodies: PREPARED })
    await rig.holder.start()
    await rig.wake()

    expect(
      await flushUntil({
        check: () => rig.runtimes.some((runtime) => runtime.released),
        attempts: 400,
      }),
    ).toBe(true)
  })

  it('leaves the queued message of an adopted sub-agent to the next holder, once', async () => {
    const a = await makeRig({ script: [{ text: CHILD_ANSWER }] })
    await seedSession(a)
    await seedChildQueue(a)
    const gate = Promise.withResolvers<void>()
    const reads = childReadsOf({ rig: a, children: [CHILD], gate: gate.promise })
    await wakeWithPrompt(a, 'go')
    expect(await flushUntil({ check: () => reads.started > 0, attempts: 400 })).toBe(true)

    const draining = a.holder.drain()
    await a.flush()
    gate.resolve()
    await draining

    const b = await makeRig({
      plane: a.plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      script: [{ text: CHILD_ANSWER }],
    })
    await b.holder.start()
    await a.bus.wake(SESSION)

    expect(
      await flushUntil({ check: () => answersOf(b).then((count) => count === 1), attempts: 600 }),
    ).toBe(true)
    await b.flush()
    expect(await answersOf(b)).toBe(1)
    expect(await promptsOf(b)).toBe(1)
  })
})
