import { describe, expect, it } from 'bun:test'

import { SessionRecord } from '../record/record-adapter'
import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const slowExecScript = [
  {
    calls: [
      { callId: 'call-1', name: 'bash', input: { command: 'echo started; sleep 0.3; echo late' } },
    ],
  },
  { text: 'after' },
] as const

describe('SessionHolder append retry deadline', () => {
  it('an append retrying past appendRetryMs stops the turn and never lands', async () => {
    const a = await makeRig({ appendRetryMs: 1_000, script: slowExecScript })
    await seedSession(a)
    await a.holder.start()
    await a.post('run')
    await a.wake()
    const dispatched = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'tool-dispatched'),
    })
    expect(dispatched).toBe(true)

    const plane = a.plane
    const originalAppend = plane.append.bind(plane)
    plane.append = (async () => {
      throw new Error('store unreachable')
    }) as typeof plane.append
    const oldEpoch = (await plane.currentLease({ sessionId: SESSION })).lease.epoch
    const seqBefore = (await a.events()).length
    const gaveUp = await flushUntil({
      check: () => !a.holder.heldIds().includes(SESSION),
      clock: a.clock,
      advanceMs: 500,
      attempts: 3000,
    })
    expect(gaveUp).toBe(true)
    plane.append = originalAppend
    a.clock.advance(10_000)
    await a.flush()
    const landed = (await a.events()).filter((event) => event.epoch === oldEpoch)
    expect(landed.length).toBe(seqBefore)
  }, 15_000)
})

describe('SessionHolder zombie (F16)', () => {
  it('a zombie holder whose host is gone is refused by epoch once B claims, and drops the session', async () => {
    const a = await makeRig({})
    await seedSession(a)

    let record: SessionRecord | undefined
    const originalOpen = SessionRecord.open.bind(SessionRecord)
    SessionRecord.open = (async (args: Parameters<typeof SessionRecord.open>[0]) => {
      record = await originalOpen(args)
      return record
    }) as typeof SessionRecord.open

    await a.holder.start()
    await a.post('start')
    await a.wake()
    const saw = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'assistant-said'),
      clock: a.clock,
      advanceMs: 5_000,
    })
    expect(saw).toBe(true)
    expect(record).toBeDefined()
    const epochA = (await a.plane.currentLease({ sessionId: SESSION })).lease.epoch

    const b = await makeRig({
      plane: a.plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      script: [{ text: 'b turn' }],
    })
    await b.holder.start()
    const granted = await a.plane.grant({ sessionId: SESSION, hostId: b.hostId() })
    expect(granted.epoch).toBe(epochA + 1)
    const appended: string[] = []
    const originalAppend = a.plane.append.bind(a.plane)
    a.plane.append = async (params) => {
      const outcome = await originalAppend(params)
      if (!outcome.ok) appended.push(outcome.refusal.kind)
      return outcome
    }

    const seqBefore = (await a.events()).length
    await expect(
      record?.append({
        threadId: THREAD_ID,
        runId: a.ids.nextRunId(),
        drafts: [{ type: 'assistant-said', parts: [{ type: 'text', text: 'zombie write' }] }],
      }),
    ).rejects.toMatchObject({ name: 'LeaseLostError', refusal: 'stale-epoch' })
    expect(appended).toEqual(['stale-epoch'])
    expect((await a.events()).length).toBe(seqBefore)
    const dropped = await flushUntil({ check: () => a.holder.heldIds().length === 0 })
    expect(dropped).toBe(true)
    SessionRecord.open = originalOpen
    a.plane.append = originalAppend
  }, 15_000)
})
