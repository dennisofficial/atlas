import { describe, expect, test } from 'bun:test'

import { reconcileAgent37Usage } from '../agent37-usage-reconcile'

const now = new Date('2026-11-20T02:05:00.000Z')

const usageOf = (instances: readonly { id: string; compute_micros: number }[]) => ({
  usage: async () => ({ instances }),
})

describe('agent37 usage reconcile', () => {
  test('meters every instance the wallet billed', async () => {
    const metered: unknown[] = []
    const summary = await reconcileAgent37Usage({
      usage: usageOf([
        { id: 'ins-1', compute_micros: 250_000 },
        { id: 'ins-2', compute_micros: 0 },
      ]),
      meter: async (params) => {
        metered.push(params)
        return 2
      },
      now,
      log: () => {},
    })
    expect(summary).toEqual({ instances: 2, meteredRuns: 2 })
    expect(metered).toHaveLength(1)
    expect(metered[0]).toEqual({
      sandboxInstanceId: 'ins-1',
      computeMicros: 250_000,
      from: Date.parse('2026-11-19T00:00:00Z'),
      to: now.getTime(),
    })
  })

  test('meters nothing when the wallet reported no instances', async () => {
    let calls = 0
    const summary = await reconcileAgent37Usage({
      usage: { usage: async () => ({}) },
      meter: async () => {
        calls += 1
        return 0
      },
      now,
      log: () => {},
    })
    expect(summary).toEqual({ instances: 0, meteredRuns: 0 })
    expect(calls).toBe(0)
  })
})
