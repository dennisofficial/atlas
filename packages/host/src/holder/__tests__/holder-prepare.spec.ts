import { describe, expect, it } from 'bun:test'

import type { PrepareResult } from '../ports'
import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

type Gate = { promise: Promise<PrepareResult>; settle(result: PrepareResult): void }

const gate = (): Gate => {
  let settle: (result: PrepareResult) => void = () => {}
  const promise = new Promise<PrepareResult>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

const typesOf = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<string[]> =>
  (await rig.events()).map((event) => event.type)

describe('SessionHolder prepare', () => {
  it('prepares a new session before its first turn, with no model call before it', async () => {
    const pending = gate()
    const rig = await makeRig({ prepare: () => pending.promise })
    await seedSession(rig)
    await rig.post('hello')
    await rig.holder.start()
    await rig.wake()
    await rig.flush()

    expect(await typesOf(rig)).toEqual([])
    expect(rig.bus.statuses(SESSION)).toContain('preparing')
    expect(rig.bus.statuses(SESSION)).not.toContain('thinking')

    pending.settle({ ok: true })
    const answered = await flushUntil({
      check: async () => (await typesOf(rig)).includes('assistant-said'),
    })
    expect(answered).toBe(true)
    const types = await typesOf(rig)
    expect(types.indexOf('workspace-prepared')).toBeLessThan(types.indexOf('user-said'))
    expect(types.filter((type) => type === 'workspace-prepared')).toHaveLength(1)
  })

  it('prepares a session with no message yet and then waits for one', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.holder.start()
    await rig.wake()
    const prepared = await flushUntil({
      check: async () => (await typesOf(rig)).includes('workspace-prepared'),
    })
    expect(prepared).toBe(true)
    expect(rig.bus.statuses(SESSION)).toContain('idle')
    expect(await typesOf(rig)).toEqual(['workspace-prepared'])
  })

  it('records a failure, starts no turn, and shows setup-failed', async () => {
    const rig = await makeRig({ prepare: async () => ({ ok: false, reason: 'clone failed' }) })
    await seedSession(rig)
    await rig.post('hello')
    await rig.holder.start()
    await rig.wake()
    const failed = await flushUntil({
      check: async () => (await typesOf(rig)).includes('workspace-prepare-failed'),
    })
    expect(failed).toBe(true)
    await rig.flush()
    expect(await typesOf(rig)).toEqual(['workspace-prepare-failed'])
    expect(rig.bus.statuses(SESSION)).toContain('setup-failed')
    expect(rig.bus.statuses(SESSION)).not.toContain('thinking')
    const events = await rig.plane.readEvents({
      threadId: THREAD_ID,
      afterSeq: 0,
      limit: 10,
      visible: false,
    })
    expect(events.events[0]).toMatchObject({ reason: 'clone failed', inboxHead: 1 })
  })

  it('retries the prepare on the next message and then runs the turn', async () => {
    let attempts = 0
    const rig = await makeRig({
      prepare: async () => {
        attempts += 1
        return attempts === 1 ? { ok: false, reason: 'setup script failed' } : { ok: true }
      },
    })
    await seedSession(rig)
    await rig.post('first')
    await rig.holder.start()
    await rig.wake()
    await flushUntil({
      check: async () => (await typesOf(rig)).includes('workspace-prepare-failed'),
    })
    await rig.flush()
    expect(attempts).toBe(1)

    await rig.post('second')
    await rig.wake()
    const answered = await flushUntil({
      check: async () => (await typesOf(rig)).includes('assistant-said'),
      attempts: 100,
    })
    expect(answered).toBe(true)
    expect(attempts).toBe(2)
    const types = await typesOf(rig)
    expect(types.indexOf('workspace-prepared')).toBeLessThan(types.indexOf('user-said'))
    expect(types.filter((type) => type === 'user-said')).toHaveLength(2)
  })

  it('does not prepare again for an already prepared session', async () => {
    let attempts = 0
    const rig = await makeRig({
      prepare: async () => {
        attempts += 1
        return { ok: true }
      },
    })
    await seedSession(rig)
    await rig.post('one')
    await rig.holder.start()
    await rig.wake()
    await flushUntil({ check: async () => (await typesOf(rig)).includes('assistant-said') })
    await rig.post('two')
    await rig.wake()
    await flushUntil({
      check: async () =>
        (await typesOf(rig)).filter((type) => type === 'assistant-said').length === 2,
      attempts: 100,
    })
    expect(attempts).toBe(1)
  })

  it('starts the turn without waiting for a prepared session whose prepare is instant', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.post('hello')
    await rig.holder.start()
    await rig.wake()
    const answered = await flushUntil({
      check: async () => (await typesOf(rig)).includes('assistant-said'),
    })
    expect(answered).toBe(true)
    expect(rig.clock.now()).toBe(0)
  })
})
