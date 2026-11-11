import { describe, expect, it } from 'bun:test'

import { EHeldOutcome, type Lease } from '@dltech/atlas-core'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { ELogSeverity, LogPort, type LogEntry } from '@dltech/atlas-observability'

import { FencedSettlement } from '../fenced-settlement'
import type { HeldSessionDeps } from '../held-session-deps'
import { teardownHeld } from '../held-teardown'
import { SESSION, THREAD } from './rig-fakes'

class CollectingLog extends LogPort {
  readonly entries: LogEntry[] = []
  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

type RevokeParams = { sessionId: string; wantsHolder: boolean; epoch?: number | undefined }

const fencedRig = async (): Promise<{
  plane: ControlPlane
  log: CollectingLog
  fenced: FencedSettlement
  calls: RevokeParams[]
  lease(): Promise<Lease>
  teardown(epoch: number): Promise<void>
}> => {
  const store = new InMemoryControlStore({ clock: () => new Date(0).toISOString() })
  const plane = new ControlPlane({ store })
  const log = new CollectingLog()
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  const host = store.nextHostId()
  store.markHostPresent(host)
  await plane.grant({ sessionId: SESSION, hostId: host })
  const calls: RevokeParams[] = []
  const original = plane.revoke.bind(plane)
  plane.revoke = (async (params: Parameters<typeof original>[0]) => {
    calls.push(params)
    return original(params)
  }) as typeof plane.revoke
  const deps = { sessionId: SESSION, plane, log } as unknown as HeldSessionDeps
  const fenced = new FencedSettlement({ plane, sessionId: SESSION, log })
  return {
    plane,
    log,
    fenced,
    calls,
    lease: async () => (await plane.currentLease({ sessionId: SESSION })).lease,
    teardown: async (epoch) => {
      await teardownHeld({
        deps,
        runtime: undefined,
        record: undefined,
        turnRunning: false,
        kind: EHeldOutcome.Fenced,
        released: false,
        epoch,
        fenced,
      })
    },
  }
}

describe('teardownHeld on a fence', () => {
  it('revokes once at the epoch the holder holds and asks for a new holder', async () => {
    const rig = await fencedRig()
    const held = await rig.lease()

    await rig.teardown(held.epoch)

    expect(rig.calls).toEqual([{ sessionId: SESSION, epoch: held.epoch, wantsHolder: true }])
    expect(await rig.lease()).toMatchObject({
      epoch: held.epoch + 1,
      holderHostId: null,
      wantsHolder: true,
    })
    expect(rig.log.entries).toEqual([])
  })

  it('a second teardown for the same holder does not revoke again', async () => {
    const rig = await fencedRig()
    const held = await rig.lease()

    await rig.teardown(held.epoch)
    const settled = await rig.lease()
    await rig.teardown(held.epoch)

    expect(rig.calls).toHaveLength(1)
    expect(await rig.lease()).toEqual(settled)
  })

  it('logs a warn rather than throwing when the lease had already moved on', async () => {
    const rig = await fencedRig()
    const held = await rig.lease()
    const successor = await rig.plane.revoke({
      sessionId: SESSION,
      wantsHolder: false,
      epoch: held.epoch,
    })
    expect(successor.ok).toBe(true)

    await rig.teardown(held.epoch)

    expect(rig.calls).toHaveLength(2)
    expect((await rig.lease()).wantsHolder).toBe(false)
    expect(rig.log.entries).toMatchObject([
      { severity: ELogSeverity.Warn, source: 'holder.settle' },
    ])
  })

  it('logs a warn rather than throwing when the control plane is unreachable', async () => {
    const rig = await fencedRig()
    const held = await rig.lease()
    rig.plane.revoke = (async () => {
      throw new Error('control plane down')
    }) as typeof rig.plane.revoke

    await rig.teardown(held.epoch)

    expect(rig.log.entries).toMatchObject([
      { severity: ELogSeverity.Warn, source: 'holder.settle' },
    ])
  })
})
