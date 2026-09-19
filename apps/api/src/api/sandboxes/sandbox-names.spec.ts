import { describe, expect, it } from 'vitest'
import { factorySandboxNameFor, sandboxNameFor } from './sandbox-names'

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

describe('factorySandboxNameFor', () => {
  it('names the sandbox after the work item, dash-safe', () => {
    expect(factorySandboxNameFor({ workItemId: 'fwi_5b2c9d1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f' })).toBe(
      'factory-fwi-5b2c9d1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    )
  })

  it('names the same sandbox for the same work item across wakes', () => {
    expect(factorySandboxNameFor({ workItemId: 'fwi_x' })).toBe(
      factorySandboxNameFor({ workItemId: 'fwi_x' }),
    )
  })
})
