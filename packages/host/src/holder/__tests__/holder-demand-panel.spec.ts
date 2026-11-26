import { describe, expect, it } from 'bun:test'

import type { ControlPlane } from '@dltech/atlas-control'
import type { Lease } from '@dltech/atlas-core'

import { HolderDemand } from '../holder-demand'
import { FakeBus, FakeClock } from './rig-fakes'

const SESSION = 'ses_panel'
const TTL_MS = 60_000

type PlaneState = {
  holderHostId: number | null
  wantsHolder: boolean
  parkedAt?: string | null | undefined
}

type PlaneCalls = {
  reads: number
  wakes: number
  revokes: { sessionId: string; wantsHolder: boolean }[]
}

const leaseOf = (args: { sessionId: string; state: PlaneState }): Lease => ({
  sessionId: args.sessionId,
  epoch: 1,
  holderHostId: args.state.holderHostId,
  wantsHolder: args.state.wantsHolder,
  attempts: 0,
  retryAfter: null,
})

const makeRig = (initial: PlaneState) => {
  const state = { ...initial }
  const calls: PlaneCalls = { reads: 0, wakes: 0, revokes: [] }
  const plane = {
    async currentLease(params: { sessionId: string }): Promise<{ lease: Lease; live: boolean }> {
      calls.reads += 1
      return {
        lease: leaseOf({ sessionId: params.sessionId, state }),
        live: state.holderHostId !== null,
      }
    },
    async readSession(): Promise<{ podParkedAt: string | null }> {
      return { podParkedAt: state.parkedAt ?? null }
    },
    async wake(): Promise<void> {
      calls.wakes += 1
    },
    async revoke(params: { sessionId: string; wantsHolder: boolean }): Promise<Lease> {
      calls.revokes.push({ sessionId: params.sessionId, wantsHolder: params.wantsHolder })
      state.wantsHolder = params.wantsHolder
      return leaseOf({ sessionId: params.sessionId, state })
    },
  } as unknown as ControlPlane
  const held = new Set<string>()
  const bus = new FakeBus()
  const demand = new HolderDemand({
    plane,
    bus,
    timers: new FakeClock(),
    holds: (sessionId) => held.has(sessionId),
    draining: () => false,
    onReconcile: () => undefined,
    terminal: undefined,
    panel: undefined,
    log: undefined,
  })
  const beat = async (): Promise<void> => {
    bus.deliverPanelHold({ sessionId: SESSION, ttlMs: TTL_MS })
    await Bun.sleep(0)
  }
  return { demand, bus, calls, state, held, beat }
}

describe('HolderDemand answering an open panel', () => {
  it('asks for a holder again on a later beat once the lease went unheld', async () => {
    const rig = makeRig({ holderHostId: null, wantsHolder: false })

    await rig.beat()
    expect(rig.calls.revokes).toEqual([{ sessionId: SESSION, wantsHolder: true }])

    rig.state.holderHostId = null
    rig.state.wantsHolder = false

    await rig.beat()
    expect(rig.calls.revokes).toEqual([
      { sessionId: SESSION, wantsHolder: true },
      { sessionId: SESSION, wantsHolder: true },
    ])
    expect(rig.state.wantsHolder).toBe(true)
  })

  it('wakes a session already wanted by the plane instead of revoking it', async () => {
    const rig = makeRig({ holderHostId: null, wantsHolder: true })

    await rig.beat()

    expect(rig.calls.wakes).toBe(1)
    expect(rig.calls.revokes).toEqual([])
  })

  it('reads the lease once per beat and leaves a session another host holds alone', async () => {
    const rig = makeRig({ holderHostId: 7, wantsHolder: false })

    await rig.beat()
    await rig.beat()
    await rig.beat()

    expect(rig.calls.reads).toBe(3)
    expect(rig.calls.wakes).toBe(0)
    expect(rig.calls.revokes).toEqual([])
  })

  it('makes no plane call on any beat while this host already holds the session', async () => {
    const rig = makeRig({ holderHostId: null, wantsHolder: false })
    rig.held.add(SESSION)

    await rig.beat()
    await rig.beat()

    expect(rig.calls).toEqual({ reads: 0, wakes: 0, revokes: [] })
  })

  it('leaves a parked session asleep on a panel hold', async () => {
    const rig = makeRig({
      holderHostId: null,
      wantsHolder: false,
      parkedAt: '2026-11-25T10:00:00.000Z',
    })

    await rig.beat()
    await rig.beat()

    expect(rig.calls.wakes).toBe(0)
    expect(rig.calls.revokes).toEqual([])
    expect(rig.state.wantsHolder).toBe(false)
  })

  it('stops answering beats after stop', async () => {
    const rig = makeRig({ holderHostId: null, wantsHolder: false })
    rig.demand.stop()

    await rig.beat()

    expect(rig.calls).toEqual({ reads: 0, wakes: 0, revokes: [] })
  })
})
