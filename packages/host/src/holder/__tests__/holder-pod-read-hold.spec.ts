import { describe, expect, it } from 'bun:test'

import type { CallOp } from '@dltech/atlas-protocol'

import type { PodCallOutcome } from '../pod-calls'
import { flushUntil, makeRig, seedSession, SESSION } from './holder-rig'

const STAT: CallOp = { op: 'stat', path: '/w/a.ts' }

describe('SessionHolder serving a routed read', () => {
  it('keeps the session while the read holds the panel, and releases it when the hold ends', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.holder.start()

    let outcome: PodCallOutcome | undefined
    const pending = rig.holder
      .podRouter()
      .invoke({ sessionId: SESSION, op: STAT, waitForHolder: true })
      .then((value) => {
        outcome = value
        return value
      })
    const answered = await flushUntil({
      check: () => outcome !== undefined,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 300,
    })
    expect(answered).toBe(true)
    expect(await pending).toMatchObject({ state: 'ok' })
    expect(rig.holder.demandOf().panel.holds(SESSION)).toBe(true)

    rig.holder.demandOf().requestReconcile(SESSION)
    await rig.flush()
    expect(rig.holder.heldIds()).toEqual([SESSION])
    expect(rig.runtimes[0]?.released).toBe(false)

    rig.holder.demandOf().panel.release(SESSION)
    rig.holder.demandOf().requestReconcile(SESSION)
    const released = await flushUntil({
      check: () => rig.holder.heldIds().length === 0,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })
    expect(released).toBe(true)
    expect(rig.runtimes[0]?.released).toBe(true)
  }, 15_000)
})
