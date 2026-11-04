import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, SESSION, type HolderRig } from './holder-rig'

const longExecScript = [
  {
    calls: [
      { callId: 'call-1', name: 'bash', input: { command: 'echo started; sleep 0.3; echo late' } },
    ],
  },
  { text: 'after handoff' },
] as const

const drainLate = async (rig: HolderRig): Promise<void> => {
  const drain = rig.holder.drain({ deadline: rig.clock.now() + 1_000 })
  rig.clock.advance(1_100)
  await drain
}

const expectRevoked = async (rig: HolderRig): Promise<void> => {
  const lease = await rig.plane.currentLease({ sessionId: SESSION })
  expect(lease.lease.holderId).toBeNull()
  expect(lease.lease.wantsHolder).toBe(true)
  expect(rig.bus.wakes.filter((id) => id === SESSION).length).toBeGreaterThanOrEqual(2)
}

describe('branch observer lifecycle on handoff', () => {
  it('handoff with a watched repo completes with revoke and wake', async () => {
    const rig = await makeRig({ holderId: 'holder-a', script: longExecScript })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('run the long thing')
    await rig.wake()
    const dispatched = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'tool-dispatched'),
    })
    expect(dispatched).toBe(true)
    const runtime = rig.runtimes[0]
    expect(runtime).toBeDefined()
    if (runtime !== undefined) runtime.watched = ['/w']

    await drainLate(rig)
    await expectRevoked(rig)
    rig.holder.discard()
  }, 15_000)

  it('handoff completes when watchedRepos never resolves', async () => {
    const rig = await makeRig({
      holderId: 'holder-b',
      script: [{ text: 'ok' }],
      watchedRepos: () => new Promise<readonly string[]>(() => {}),
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('go')
    await rig.wake()
    const said = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(said).toBe(true)

    await drainLate(rig)
    await expectRevoked(rig)
    rig.holder.discard()
  }, 15_000)
})
