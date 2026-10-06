import { describe, expect, it } from 'bun:test'

describe('evals workspace skeleton', () => {
  it('resolves so the workspace typecheck/test tasks pass before the eval slice lands', () => {
    expect(true).toBe(true)
  })
})
