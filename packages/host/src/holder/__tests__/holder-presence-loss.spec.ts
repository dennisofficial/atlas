import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, postAndRun, seedSession, SESSION, type HolderRig } from './holder-rig'

const slowExecScript = [
  {
    calls: [
      { callId: 'call-1', name: 'bash', input: { command: 'echo started; sleep 0.3; echo late' } },
    ],
  },
  { text: 'after' },
] as const

const answers = async (rig: HolderRig): Promise<number> =>
  (await rig.events()).filter((event) => event.type === 'assistant-said').length

const currentEpoch = async (rig: HolderRig): Promise<number> =>
  (await rig.plane.currentLease({ sessionId: SESSION })).lease.epoch

const countRegisters = (): { gate(): Promise<void>; calls(): number } => {
  let calls = 0
  return {
    gate: async () => {
      calls += 1
    },
    calls: () => calls,
  }
}

const answerFirstTurn = async (rig: HolderRig): Promise<void> => {
  await seedSession(rig)
  await rig.holder.start()
  await postAndRun(rig, 'first')
  const answered = await flushUntil({
    check: async () => (await answers(rig)) === 1,
    clock: rig.clock,
  })
  expect(answered).toBe(true)
}

describe('SessionHolder presence loss', () => {
  it('drops a running turn, registers a new host id and re-claims at the next epoch', async () => {
    const a = await makeRig({ script: slowExecScript })
    await seedSession(a)
    await a.holder.start()
    const oldId = a.hostId()
    await a.post('run')
    await a.wake()
    const dispatched = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'tool-dispatched'),
    })
    expect(dispatched).toBe(true)
    const oldEpoch = await currentEpoch(a)
    const before = await a.events()
    const lastSeq = Math.max(...before.map((event) => event.seq))
    a.script.current = [{ text: 'recovered' }]

    a.presence.lose()

    const answered = await flushUntil({
      check: async () => (await answers(a)) === 1,
      clock: a.clock,
      attempts: 3000,
      advanceMs: 1_000,
    })
    expect(answered).toBe(true)
    expect(a.hostId()).not.toBe(oldId)
    expect(await currentEpoch(a)).toBeGreaterThan(oldEpoch)
    const stale = (await a.events()).filter(
      (event) => event.epoch === oldEpoch && event.seq > lastSeq,
    )
    expect(stale).toEqual([])
  }, 15_000)

  it('never claims with the dead id while the new registration is pending', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    const a = await makeRig({
      script: [{ text: 'first' }],
      beforeRegister: async () => {
        calls += 1
        if (calls === 2) await gate
      },
    })
    await answerFirstTurn(a)
    const oldId = a.hostId()
    const claimedWith: number[] = []
    const originalClaim = a.plane.claimNext.bind(a.plane)
    a.plane.claimNext = async (params) => {
      claimedWith.push(params.hostId)
      return originalClaim(params)
    }
    a.script.current = [{ text: 'second' }]

    a.presence.lose()
    await a.post('while down')
    await a.wake()
    await a.flush()
    expect(claimedWith).toEqual([])

    release?.()
    const answered = await flushUntil({
      check: async () => (await answers(a)) === 2,
      clock: a.clock,
      attempts: 3000,
      advanceMs: 1_000,
    })
    expect(answered).toBe(true)
    expect(claimedWith).not.toContain(oldId)
  }, 15_000)

  it('does not re-register when the loss lands while draining', async () => {
    const registers = countRegisters()
    const a = await makeRig({ beforeRegister: registers.gate })
    await a.holder.start()
    const drained = a.holder.drain({ deadline: a.clock.now() + 1_000 })
    a.presence.lose()
    await drained
    await a.flush()
    expect(registers.calls()).toBe(1)
    expect(a.clock.pendingCount()).toBe(0)
  })

  it('retries a failing register on one backoff timer until it succeeds, then re-claims', async () => {
    let calls = 0
    const a = await makeRig({
      script: [{ text: 'first' }],
      beforeRegister: async () => {
        calls += 1
        if (calls === 2 || calls === 3) throw new Error('presence database unreachable')
      },
    })
    await answerFirstTurn(a)
    const epoch = await currentEpoch(a)
    const oldId = a.hostId()
    a.script.current = [{ text: 'second' }]

    a.presence.lose()
    await a.post('again')
    await a.flush()
    expect(calls).toBe(2)
    expect(a.clock.pendingCount()).toBe(1)

    a.clock.advance(250)
    await a.flush()
    expect(calls).toBe(3)
    expect(a.clock.pendingCount()).toBe(1)

    a.clock.advance(500)
    await a.flush()
    expect(calls).toBe(4)
    expect(a.hostId()).not.toBe(oldId)

    const answered = await flushUntil({
      check: async () => (await answers(a)) === 2,
      clock: a.clock,
      attempts: 3000,
      advanceMs: 1_000,
    })
    expect(answered).toBe(true)
    expect(await currentEpoch(a)).toBeGreaterThan(epoch)
  }, 15_000)

  it('drain cancels the pending register retry', async () => {
    let calls = 0
    const a = await makeRig({
      beforeRegister: async () => {
        calls += 1
        if (calls > 1) throw new Error('presence database unreachable')
      },
    })
    await a.holder.start()
    a.presence.lose()
    await a.flush()
    expect(calls).toBe(2)
    expect(a.clock.pendingCount()).toBe(1)

    await a.holder.drain({ deadline: a.clock.now() + 1_000 })
    expect(a.clock.pendingWithin(60_000)).toBe(false)
    a.clock.advance(60_000)
    await a.flush()
    expect(calls).toBe(2)
  })

  it('ignores a late loss notice for an id it no longer holds', async () => {
    const registers = countRegisters()
    const a = await makeRig({ script: [{ text: 'first' }], beforeRegister: registers.gate })
    let notify: ((hostId: number) => void) | undefined
    const originalOnLost = a.presence.onLost.bind(a.presence)
    a.presence.onLost = (listener) => {
      notify = listener
      return originalOnLost(listener)
    }
    await answerFirstTurn(a)
    const oldId = a.hostId()
    a.presence.lose()
    await a.flush()
    const newId = a.hostId()
    expect(newId).not.toBe(oldId)
    const heldBefore = a.holder.heldIds()
    const registersBefore = registers.calls()

    notify?.(oldId)
    await a.flush()

    expect(registers.calls()).toBe(registersBefore)
    expect(a.hostId()).toBe(newId)
    expect(a.holder.heldIds()).toEqual(heldBefore)
  })
})
