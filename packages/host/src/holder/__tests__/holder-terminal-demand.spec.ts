import { describe, expect, it } from 'bun:test'

import { idleReleaseDue } from '../held-idle'
import type { SessionRuntime } from '../ports'
import { flushUntil, makeRig, seedSession, SESSION } from './holder-rig'

const runtime = {} as SessionRuntime

describe('idleReleaseDue with terminal demand', () => {
  it('keeps a session with an attached terminal stream', () => {
    expect(
      idleReleaseDue({
        turnRunning: false,
        runtime,
        pendingInput: false,
        runningShells: 0,
        runningChildren: 0,
        terminalStreams: 1,
        panelHolds: 0,
      }),
    ).toBe(false)
  })

  it('releases once the last terminal stream drops', () => {
    expect(
      idleReleaseDue({
        turnRunning: false,
        runtime,
        pendingInput: false,
        runningShells: 0,
        runningChildren: 0,
        terminalStreams: 0,
        panelHolds: 0,
      }),
    ).toBe(true)
  })
})

describe('SessionHolder with an attached terminal stream', () => {
  it('stays held while a stream is attached and releases once when it drops', async () => {
    let streams = 1
    const rig = await makeRig({ terminalStreams: () => streams })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()

    const answered = await flushUntil({
      check: async () =>
        (await rig.events()).filter((event) => event.type === 'assistant-said').length === 1,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })
    expect(answered).toBe(true)
    await rig.flush()
    expect(rig.holder.heldIds()).toEqual([SESSION])
    expect(rig.runtimes[0]?.released).toBe(false)

    streams = 0
    rig.holder.demandOf().requestReconcile(SESSION)
    const released = await flushUntil({
      check: () => rig.holder.heldIds().length === 0,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })
    expect(released).toBe(true)
    expect(rig.runtimes[0]?.released).toBe(true)
    await rig.flush()
    expect(rig.runtimes.length).toBe(1)
    expect((await rig.plane.currentLease({ sessionId: SESSION })).lease.wantsHolder).toBe(false)
  }, 15_000)
})
