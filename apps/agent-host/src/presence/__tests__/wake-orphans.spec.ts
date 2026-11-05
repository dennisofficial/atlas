import { describe, expect, it } from 'bun:test'

import { ORPHAN_SCAN_LIMIT, wakeOrphans } from '../wake-orphans'

const fakePlane = (ids: string[]) => {
  const calls: { limit: number[]; woken: (readonly string[])[] } = { limit: [], woken: [] }
  return {
    calls,
    plane: {
      sessionsNeedingHolder: (params: { limit: number }) => {
        calls.limit.push(params.limit)
        return Promise.resolve(ids)
      },
      wake: (params: { sessionIds: readonly string[] }) => {
        calls.woken.push(params.sessionIds)
        return Promise.resolve()
      },
    },
  }
}

describe('wakeOrphans', () => {
  it('wakes every session that needs a holder, scanning up to the limit', async () => {
    const { plane, calls } = fakePlane(['a', 'b'])
    expect(await wakeOrphans({ plane })).toBe(2)
    expect(calls.limit).toEqual([ORPHAN_SCAN_LIMIT])
    expect(calls.woken).toEqual([['a', 'b']])
  })

  it('wakes nothing when no session needs a holder', async () => {
    const { plane, calls } = fakePlane([])
    expect(await wakeOrphans({ plane })).toBe(0)
    expect(calls.woken).toEqual([])
  })
})
