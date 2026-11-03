import { describe, expect, it } from 'bun:test'

import { CODE_CHALLENGE_PATTERN, CODE_VERIFIER_PATTERN } from '@dltech/atlas-wire/web'

import { base64UrlEncode, createPkcePair, sha256Hex, type IPkceCrypto } from '../pkce'

const testCrypto: IPkceCrypto = {
  randomBytes: (length) => {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    return bytes
  },
  sha256Bytes: async (value) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
}

describe('base64UrlEncode', () => {
  it('encodes bytes as unpadded base64url', () => {
    expect(base64UrlEncode({ bytes: new Uint8Array([0xfb, 0xff, 0xfe]) })).toBe('-__-')
  })

  it('strips trailing padding', () => {
    expect(base64UrlEncode({ bytes: new Uint8Array([1]) })).toBe('AQ')
  })
})

describe('createPkcePair', () => {
  it('produces a verifier the server-side pattern accepts', async () => {
    const pair = await createPkcePair({ crypto: testCrypto })
    expect(pair.verifier).toMatch(CODE_VERIFIER_PATTERN)
    expect(pair.verifier.length).toBe(43)
  })

  it('produces a 43-char base64url challenge that is the SHA-256 of the verifier', async () => {
    const pair = await createPkcePair({ crypto: testCrypto })
    expect(pair.challenge).toMatch(CODE_CHALLENGE_PATTERN)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pair.verifier))
    expect(pair.challenge).toBe(base64UrlEncode({ bytes: new Uint8Array(digest) }))
  })

  it('produces distinct pairs on successive calls', async () => {
    const first = await createPkcePair({ crypto: testCrypto })
    const second = await createPkcePair({ crypto: testCrypto })
    expect(first.verifier).not.toBe(second.verifier)
    expect(first.state).not.toBe(second.state)
  })
})

describe('sha256Hex', () => {
  it('hashes to lowercase hex', async () => {
    expect(await sha256Hex({ crypto: testCrypto, value: 'abc' })).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
