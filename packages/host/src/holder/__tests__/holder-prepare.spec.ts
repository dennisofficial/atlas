import { describe, expect, it } from 'bun:test'

import { chainEvents, toRunId, toThreadId, type V2Body } from '@dltech/atlas-core'

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

const seedLog = async (args: { rig: Awaited<ReturnType<typeof makeRig>>; bodies: V2Body[] }) => {
  const { rig } = args
  const { epoch } = await rig.plane.grant({ sessionId: SESSION, hostId: 9001 })
  const outcome = await rig.plane.append({
    threadId: THREAD_ID,
    epoch,
    events: chainEvents({
      threadId: toThreadId(THREAD_ID),
      runId: toRunId('seed-run'),
      epoch,
      at: new Date(0).toISOString(),
      bodies: args.bodies,
      from: await rig.plane.head({ threadId: THREAD_ID }),
    }),
  })
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
  await rig.plane.revoke({ sessionId: SESSION, wantsHolder: false })
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
    const events = await rig.plane.readEvents({
      threadId: THREAD_ID,
      afterSeq: 0,
      limit: 10,
      visible: false,
    })
    expect(events.events[0]).toMatchObject({ reason: 'clone failed', inboxHead: 1 })
  })

  it('still records a failure when the prepare itself throws', async () => {
    const rig = await makeRig({
      prepare: async () => {
        throw new Error('sandbox could not be created')
      },
    })
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

  it('releases an idle session whose only message is covered by the failure, without polling', async () => {
    const rig = await makeRig({ idleMinutes: 1 })
    await seedSession(rig)
    await rig.post('hello')
    await seedLog({
      rig,
      bodies: [{ type: 'workspace-prepare-failed', reason: 'clone failed', inboxHead: 1 }],
    })
    let reads = 0
    const readInbox = rig.plane.readInbox.bind(rig.plane)
    rig.plane.readInbox = ((params: Parameters<typeof rig.plane.readInbox>[0]) => {
      reads += 1
      return readInbox(params)
    }) as typeof rig.plane.readInbox
    await rig.holder.start()
    await rig.wake()
    await rig.flush()
    expect(rig.runtimes[0]?.released).toBe(false)
    const readsAtStart = reads

    rig.clock.advance(61_000)
    const released = await flushUntil({ check: () => rig.runtimes[0]?.released === true })
    expect(released).toBe(true)
    expect(rig.holder.heldIds()).toEqual([])
    expect(reads - readsAtStart).toBeLessThan(10)
    expect(await typesOf(rig)).toEqual(['workspace-prepare-failed'])
  })

  it('builds a fresh runtime, and so a new sandbox wake, when a newer message retries a failed prepare', async () => {
    let attempts = 0
    const rig = await makeRig({
      prepare: async () => {
        attempts += 1
        return attempts === 1 ? { ok: false, reason: 'sandbox wake rejected' } : { ok: true }
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
    expect(rig.runtimes).toHaveLength(1)
    expect(rig.runtimes[0]?.stopped).toBe(true)
    expect(rig.holder.heldIds()).toEqual([])

    await rig.post('second')
    await rig.wake()
    const answered = await flushUntil({
      check: async () => (await typesOf(rig)).includes('assistant-said'),
      attempts: 100,
    })
    expect(answered).toBe(true)
    expect(rig.runtimes).toHaveLength(2)
    expect(attempts).toBe(2)
  })

  it('a stop during the prepare consumes the messages before it, so none of them runs', async () => {
    const pending = gate()
    const rig = await makeRig({ prepare: () => pending.promise })
    await seedSession(rig)
    await rig.post('do not run me')
    await rig.holder.start()
    await rig.wake()
    await rig.flush()
    await rig.postStop()
    await rig.wake()
    await rig.flush()

    pending.settle({ ok: true })
    await flushUntil({ check: async () => (await typesOf(rig)).includes('workspace-prepared') })
    await rig.flush()
    const types = await typesOf(rig)
    expect(types).not.toContain('user-said')
    expect(types).not.toContain('assistant-said')
    expect(await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })).toEqual([])
  })
})
