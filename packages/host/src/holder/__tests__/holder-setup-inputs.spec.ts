import { describe, expect, it } from 'bun:test'

import type { PrepareResult } from '../ports'
import { flushUntil, makeRig, seedSession } from './holder-rig'

type Gate = {
  prepare: () => Promise<PrepareResult>
  started: () => boolean
  settle: (result: PrepareResult) => void
}

const gate = (): Gate => {
  let settle: (result: PrepareResult) => void = () => {}
  let started = false
  const promise = new Promise<PrepareResult>((resolve) => {
    settle = resolve
  })
  return {
    prepare: async () => {
      started = true
      return await promise
    },
    started: () => started,
    settle: (result) => settle(result),
  }
}

const typesOf = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<string[]> =>
  (await rig.events()).map((event) => event.type)

const countOf = async (rig: Awaited<ReturnType<typeof makeRig>>, type: string): Promise<number> =>
  (await typesOf(rig)).filter((seen) => seen === type).length

describe('a message staged while the workspace is preparing', () => {
  it('is logged as input-posted during setup, then said and answered once prepared', async () => {
    const pending = gate()
    const rig = await makeRig({ prepare: pending.prepare })
    await seedSession(rig)
    await rig.post('during setup')
    await rig.holder.start()
    await rig.wake()
    expect(
      await flushUntil({
        check: async () => (await countOf(rig, 'input-posted')) === 1,
        attempts: 100,
      }),
    ).toBe(true)
    expect(pending.started()).toBe(true)

    const duringSetup = await typesOf(rig)
    expect(duringSetup).not.toContain('workspace-prepared')
    expect(duringSetup).not.toContain('user-said')

    await rig.post('later in setup')
    await rig.wake()
    expect(
      await flushUntil({
        check: async () => (await countOf(rig, 'input-posted')) === 2,
        attempts: 100,
      }),
    ).toBe(true)
    expect(await typesOf(rig)).not.toContain('workspace-prepared')

    pending.settle({ ok: true })
    expect(
      await flushUntil({
        check: async () => (await countOf(rig, 'assistant-said')) > 0,
        attempts: 200,
      }),
    ).toBe(true)

    const types = await typesOf(rig)
    expect(types.indexOf('workspace-prepared')).toBeLessThan(types.indexOf('user-said'))
    expect(await countOf(rig, 'input-posted')).toBe(2)
    expect(await countOf(rig, 'user-said')).toBe(2)
  }, 15_000)
})
