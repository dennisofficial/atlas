import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'

import { generatePkce } from '../pkce'

describe('generatePkce', () => {
  it('returns a 43-character base64url verifier with no padding', () => {
    const { verifier } = generatePkce()

    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('derives the challenge as base64url(SHA-256(verifier))', () => {
    const pkce = generatePkce()

    expect(pkce.challenge).toBe(
      createHash('sha256').update(pkce.verifier).digest('base64url'),
    )
  })

  it('returns a 64-character hex state', () => {
    const { state } = generatePkce()

    expect(state).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates distinct values on every call', () => {
    const first = generatePkce()
    const second = generatePkce()

    expect(first.verifier).not.toBe(second.verifier)
    expect(first.state).not.toBe(second.state)
  })
})
