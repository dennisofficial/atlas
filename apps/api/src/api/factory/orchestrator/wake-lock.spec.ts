import { describe, expect, it } from 'vitest'
import { wakeLockKeyOf, WAKE_LOCK_NAMESPACE } from './wake-lock'

describe('wakeLockKeyOf', () => {
  it('is deterministic for a work item id', () => {
    const a = wakeLockKeyOf({ workItemId: 'fwi_abc' })
    const b = wakeLockKeyOf({ workItemId: 'fwi_abc' })
    expect(a).toBe(b)
  })

  it('gives distinct keys to distinct work items', () => {
    expect(wakeLockKeyOf({ workItemId: 'fwi_abc' })).not.toBe(
      wakeLockKeyOf({ workItemId: 'fwi_xyz' }),
    )
  })

  it('stays within the 60-bit space so it never collides with the namespace bit pattern', () => {
    const key = wakeLockKeyOf({ workItemId: 'fwi_abc' })
    expect(key >= 0n).toBe(true)
    expect(key <= 0x0fffffffffffffffn).toBe(true)
    expect(typeof WAKE_LOCK_NAMESPACE).toBe('number')
  })
})
