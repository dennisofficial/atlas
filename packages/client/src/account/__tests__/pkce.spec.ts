import { describe, expect, it } from 'bun:test'

import { createPkcePair, pkceChallengeOf } from '../pkce'

const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/

const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/

describe('a pkce pair', () => {
  it('answers the verifier of the RFC 7636 appendix B example', async () => {
    expect(await pkceChallengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('builds a 43 character verifier from 32 bytes and its S256 challenge', async () => {
    const pair = await createPkcePair()

    expect(pair.verifier).toMatch(VERIFIER_PATTERN)
    expect(pair.verifier).toHaveLength(43)
    expect(pair.challenge).toMatch(CHALLENGE_PATTERN)
    expect(pair.challenge).toBe(await pkceChallengeOf(pair.verifier))
    expect(pair.state.length).toBeGreaterThan(20)
  })

  it('never repeats a verifier or a state', async () => {
    const pairs = await Promise.all(Array.from({ length: 20 }, () => createPkcePair()))

    expect(new Set(pairs.map((pair) => pair.verifier)).size).toBe(pairs.length)
    expect(new Set(pairs.map((pair) => pair.state)).size).toBe(pairs.length)
  })
})
