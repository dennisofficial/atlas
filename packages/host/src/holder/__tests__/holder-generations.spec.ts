import { describe, expect, it } from 'bun:test'

import { chainEvents, toRunId } from '@dltech/atlas-core'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'

import { createMemoryHostPresence } from '../../testing/memory-host-presence'
import { HolderPresence } from '../holder-presence'
import { FakeClock } from './rig-fakes'
import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'

const gateFirst = <A extends unknown[], R>(
  original: (...args: A) => Promise<R>,
): { wrapped: (...args: A) => Promise<R>; entered: Promise<void>; release(): void } => {
  let calls = 0
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const enteredPromise = new Promise<void>((resolve) => (entered = resolve))
  return {
    wrapped: async (...args: A) => {
      calls += 1
      if (calls === 1) {
        entered()
        await gate
      }
      return original(...args)
    },
    entered: enteredPromise,
    release,
  }
}

const answered = (rig: HolderRig): Promise<boolean> =>
  flushUntil({
    clock: rig.clock,
    advanceMs: 1_000,
    attempts: 400,
    check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
  })

describe('SessionHolder host generations', () => {
  it('a claim issued under a lost host id is retried under the new one', async () => {
    const rig = await makeRig({ script: [{ text: 'recovered' }] })
    await seedSession(rig)
    await rig.holder.start()
    const oldId = rig.hostId()
    const claim = gateFirst(rig.plane.claimNext.bind(rig.plane))
    rig.plane.claimNext = claim.wrapped
    await rig.post('hello')
    await rig.wake()
    await claim.entered

    rig.presence.lose()
    await rig.flush()
    expect(rig.hostId()).not.toBe(oldId)
    claim.release()

    expect(await answered(rig)).toBe(true)
    const lease = await rig.plane.currentLease({ sessionId: SESSION })
    expect(lease.lease.holderHostId).toBe(rig.hostId())
  })

  it('a hold whose session read straddles the loss never starts under the dead id', async () => {
    const rig = await makeRig({ script: [{ text: 'recovered' }] })
    await seedSession(rig)
    await rig.holder.start()
    const read = gateFirst(rig.plane.readSession.bind(rig.plane))
    rig.plane.readSession = read.wrapped
    await rig.post('hello')
    await rig.wake()
    await read.entered

    rig.presence.lose()
    await rig.flush()
    read.release()

    expect(await answered(rig)).toBe(true)
    expect(rig.runtimes.length).toBe(1)
    const lease = await rig.plane.currentLease({ sessionId: SESSION })
    expect(lease.lease.holderHostId).toBe(rig.hostId())
  })

  it('a takeover that finishes opening after the loss writes nothing and the new id recovers', async () => {
    let runtimes = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let watchCalls = 0
    const rig = await makeRig({
      script: [{ text: 'recovered' }],
      watchedRepos: async () => {
        watchCalls += 1
        return []
      },
      beforeRuntime: async () => {
        runtimes += 1
        if (runtimes === 1) await gate
      },
    })
    await seedSession(rig)
    const seeded = await rig.plane.grant({ sessionId: SESSION, hostId: 999 })
    const dispatched = await rig.plane.append({
      threadId: THREAD_ID,
      epoch: seeded.epoch,
      events: chainEvents({
        threadId: THREAD_ID,
        runId: toRunId('run-crashed'),
        epoch: seeded.epoch,
        bodies: [{ type: 'tool-dispatched', callId: 'call-crashed' as never, name: 'bash' }],
        at: new Date(rig.clock.now()).toISOString(),
      }),
    })
    expect(dispatched.ok).toBe(true)
    await rig.plane.revoke({ sessionId: SESSION, wantsHolder: false })
    const appendEpochs: number[] = []
    const originalAppend = rig.plane.append.bind(rig.plane)
    rig.plane.append = async (params) => {
      appendEpochs.push(params.epoch)
      return originalAppend(params)
    }
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()
    await rig.flush()
    const oldEpoch = (await rig.plane.currentLease({ sessionId: SESSION })).lease.epoch

    rig.presence.lose()
    await rig.flush()
    release()

    expect(await answered(rig)).toBe(true)
    expect(appendEpochs.filter((epoch) => epoch === oldEpoch)).toEqual([])
    expect(watchCalls).toBe(1)
    expect((await rig.events()).filter((event) => event.epoch === oldEpoch)).toEqual([])
  })

  it('abandon for an older generation never touches the current host id', async () => {
    const store = new InMemoryControlStore()
    const memory = createMemoryHostPresence({ store })
    const abandoned: number[] = []
    const presence = {
      ...memory,
      abandon: async (hostId: number) => {
        abandoned.push(hostId)
        await memory.abandon(hostId)
      },
    }
    const holder = new HolderPresence({
      presence,
      timers: new FakeClock(),
      log: undefined,
      onLost: () => undefined,
      onRegistered: () => undefined,
    })
    await holder.start()
    const oldId = holder.current()
    memory.lose()
    expect(await flushUntil({ check: () => holder.current() !== undefined })).toBe(true)
    const newId = holder.current()
    expect(newId).not.toBe(oldId)

    await holder.abandon(oldId as number)
    expect(abandoned).toEqual([])
    await holder.abandon(newId as number)
    expect(abandoned).toEqual([newId as number])
  })
})
