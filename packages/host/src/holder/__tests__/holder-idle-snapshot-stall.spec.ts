import { describe, expect, it } from 'bun:test'
import { FakeChangeContentStore } from '@dltech/atlas-control/testing'
import { LogPort, type LogEntry } from '@dltech/atlas-observability'

import { flushUntil, makeRig, seedSession, SESSION, type HolderRig } from './holder-rig'

class CollectingLog extends LogPort {
  readonly entries: LogEntry[] = []
  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const answered = async (rig: HolderRig): Promise<boolean> =>
  (await rig.events()).some((event) => event.type === 'assistant-said')

const holderOf = async (rig: HolderRig): Promise<number | null> =>
  (await rig.plane.currentLease({ sessionId: SESSION })).lease.holderHostId

describe('SessionHolder idle release with a change snapshot that never settles', () => {
  it('revokes the lease and warns once the snapshot stop passes its deadline', async () => {
    const log = new CollectingLog()
    let checkoutReads = 0
    const rig = await makeRig({
      changes: { content: new FakeChangeContentStore() },
      watchedCheckouts: () => {
        checkoutReads += 1
        return new Promise<readonly string[]>(() => {})
      },
      log,
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()
    expect(await flushUntil({ check: () => answered(rig), clock: rig.clock })).toBe(true)
    expect(await flushUntil({ check: () => rig.runtimes[0]?.released === true })).toBe(true)
    expect(checkoutReads).toBeGreaterThan(0)

    const revoked = await flushUntil({
      check: async () => (await holderOf(rig)) === null,
      clock: rig.clock,
      advanceMs: 15_000,
      attempts: 200,
    })

    expect(revoked).toBe(true)
    expect(rig.holder.heldIds()).toEqual([])
    expect(
      log.entries.filter(
        (entry) => entry.severity === 'warn' && entry.source === 'holder.observation',
      ),
    ).toHaveLength(1)
  }, 20_000)
})
