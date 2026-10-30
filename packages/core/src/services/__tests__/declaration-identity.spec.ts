import { describe, expect, it } from 'bun:test'

import { declarationHash } from '../declaration-identity'

describe('declarationHash', () => {
  it('ignores key order and undefined fields', () => {
    expect(declarationHash({ command: 'a', cwd: 'x', env: { B: '1', A: '2' } })).toBe(
      declarationHash({
        env: { A: '2', B: '1' },
        cwd: 'x',
        command: 'a',
        health: undefined,
      }),
    )
  })

  it('changes when the declaration changes', () => {
    expect(declarationHash({ command: 'a' })).not.toBe(declarationHash({ command: 'b' }))
    expect(declarationHash({ command: 'a', setup: ['i'] })).not.toBe(
      declarationHash({ command: 'a' }),
    )
  })

  it('is 8 hex characters', () => {
    expect(declarationHash({ command: 'a' })).toMatch(/^[0-9a-f]{8}$/)
  })
})
