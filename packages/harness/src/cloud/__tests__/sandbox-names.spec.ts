import { describe, expect, it } from 'bun:test'

import { sandboxNameFor } from '../sandbox-names'

describe('sandboxNameFor', () => {
  it('is the deterministic name both sides of the contract derive', () => {
    expect(sandboxNameFor({ threadId: 'brn_cloud' })).toBe('atlas-thread-6bd6f7449010d2f1a3e47327')
  })

  it('never carries characters Vercel would refuse', () => {
    expect(sandboxNameFor({ threadId: 'brn_With Weïrd/Chars' })).toMatch(/^atlas-thread-[0-9a-f]{24}$/)
  })
})
