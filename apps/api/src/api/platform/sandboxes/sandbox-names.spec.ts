import { describe, expect, it } from 'vitest'
import { sandboxNameFor } from './sandbox-names'

const THREAD = 'brn_thread_1'
const SIBLING = 'brn_thread_2'

describe('sandboxNameFor', () => {
  it('gives every thread its own sandbox', () => {
    expect(sandboxNameFor({ threadId: THREAD })).not.toBe(sandboxNameFor({ threadId: SIBLING }))
  })

  it('names the same sandbox for the same thread across attaches', () => {
    expect(sandboxNameFor({ threadId: THREAD })).toBe(sandboxNameFor({ threadId: THREAD }))
  })
})
