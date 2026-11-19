import { describe, expect, it } from 'bun:test'
import type { LogPort } from '@dltech/atlas-observability'

import { flushUntil, makeRig, postAndRun, seedSession, SESSION, type HolderRig } from './holder-rig'

const IDLE_MS = 13_000

const settleFirstTurn = async (rig: HolderRig): Promise<void> => {
  await seedSession(rig)
  await rig.holder.start()
  await postAndRun(rig, 'hello')
  const saw = await flushUntil({
    check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    clock: rig.clock,
    advanceMs: 2_000,
  })
  expect(saw).toBe(true)
}

const releasedWithin = (rig: HolderRig): Promise<boolean> =>
  flushUntil({
    check: () => rig.runtimes[0]?.released === true,
    attempts: 100,
    clock: rig.clock,
    advanceMs: 1_000,
  })

describe('SessionHolder idle release with running shells', () => {
  it('keeps a held session while a shell runs and releases it once the shell ends', async () => {
    const shells = { running: 1, asked: 0 }
    const rig = await makeRig({
      runningShells: async () => {
        shells.asked += 1
        return shells.running
      },
    })
    await settleFirstTurn(rig)
    await rig.flush()
    expect(shells.asked).toBeGreaterThanOrEqual(1)
    expect(rig.runtimes[0]?.released).toBe(false)
    expect(rig.holder.heldIds().length).toBe(1)

    shells.running = 0
    await rig.bus.wake(SESSION)
    expect(await releasedWithin(rig)).toBe(true)
  }, 15_000)

  it('releases an idle session with no shells', async () => {
    const rig = await makeRig({ runningShells: async () => 0 })
    await settleFirstTurn(rig)
    rig.clock.advance(IDLE_MS)
    expect(await releasedWithin(rig)).toBe(true)
  }, 15_000)

  it('releases and warns when the daemon cannot be reached', async () => {
    const warnings: string[] = []
    const log = {
      warn: (entry: { message: string }) => warnings.push(entry.message),
      error: () => {},
      info: () => {},
      debug: () => {},
    } as unknown as LogPort
    const rig = await makeRig({
      log,
      runningShells: async () => {
        throw new Error('daemon down')
      },
    })
    await settleFirstTurn(rig)
    rig.clock.advance(IDLE_MS)
    expect(await releasedWithin(rig)).toBe(true)
    expect(warnings.length).toBeGreaterThan(0)
  }, 15_000)

  it('releases when the shell count never answers', async () => {
    const rig = await makeRig({
      runningShells: () => new Promise<number>(() => {}),
    })
    await settleFirstTurn(rig)
    rig.clock.advance(IDLE_MS)
    await rig.flush()
    rig.clock.advance(30_000)
    expect(await releasedWithin(rig)).toBe(true)
  }, 15_000)
})
