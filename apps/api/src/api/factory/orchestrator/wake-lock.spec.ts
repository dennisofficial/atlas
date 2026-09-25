import { describe, expect, it } from 'vitest'
import { wakeLockKeyOf } from './wake-lock'

describe('wakeLockKeyOf', () => {
  it('is deterministic for a work item id', () => {
    expect(wakeLockKeyOf({ workItemId: 'fwi_abc' })).toBe(wakeLockKeyOf({ workItemId: 'fwi_abc' }))
  })

  it('gives distinct keys to distinct work items', () => {
    expect(wakeLockKeyOf({ workItemId: 'fwi_abc' })).not.toBe(
      wakeLockKeyOf({ workItemId: 'fwi_xyz' }),
    )
  })

  it('stays non-negative and within the signed bigint range the single-arg lock form takes', () => {
    const key = wakeLockKeyOf({ workItemId: 'fwi_abc' })
    expect(key >= 0n).toBe(true)
    expect(key <= 0x7fffffffffffffffn).toBe(true)
  })
})
