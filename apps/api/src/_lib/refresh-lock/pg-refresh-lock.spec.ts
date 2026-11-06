import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { PgRefreshLock } from './pg-refresh-lock'
import { InProcessRefreshLock } from './refresh-lock'

const holders = () => {
  let active = 0
  let peak = 0
  return {
    peak: () => peak,
    work: async (value: string) => {
      active += 1
      peak = Math.max(peak, active)
      await Bun.sleep(15)
      active -= 1
      return value
    },
  }
}

describe('PgRefreshLock', () => {
  useTestDatabase()

  it('lets one holder at a time per key across independent lock instances', async () => {
    const tracked = holders()
    const nodes = [new PgRefreshLock(), new PgRefreshLock()]

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        nodes[index % 2]?.run({ key: 'grant-1', work: () => tracked.work(`r${index}`) }),
      ),
    )

    expect(tracked.peak()).toBe(1)
    expect(results).toEqual(Array.from({ length: 8 }, (_, index) => `r${index}`))
  })

  it('lets different keys run together', async () => {
    const tracked = holders()
    const lock = new PgRefreshLock()

    await Promise.all(['a', 'b'].map((key) => lock.run({ key, work: () => tracked.work(key) })))

    expect(tracked.peak()).toBe(2)
  })

  it('releases the lock when the work throws', async () => {
    const lock = new PgRefreshLock()

    await expect(
      lock.run({
        key: 'grant-2',
        work: async () => {
          throw new Error('boom')
        },
      }),
    ).rejects.toThrow('boom')

    expect(await lock.run({ key: 'grant-2', work: async () => 'next' })).toBe('next')
  })
})

describe('InProcessRefreshLock', () => {
  it('serializes one key and survives a failing holder', async () => {
    const tracked = holders()
    const lock = new InProcessRefreshLock()

    const settled = await Promise.allSettled([
      lock.run({ key: 'k', work: () => tracked.work('a') }),
      lock.run({
        key: 'k',
        work: async () => {
          throw new Error('boom')
        },
      }),
      lock.run({ key: 'k', work: () => tracked.work('c') }),
    ])

    expect(tracked.peak()).toBe(1)
    expect(settled.map((entry) => entry.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
  })
})
