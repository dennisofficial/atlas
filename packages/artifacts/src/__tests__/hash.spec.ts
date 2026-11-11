import { describe, expect, it } from 'bun:test'

import { canonicalJson, hashOf, sha256Hex } from '../hash'

const digests = [
  { input: '', expected: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  { input: 'abc', expected: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
  {
    input: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    expected: '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  },
  {
    input: 'The quick brown fox jumps over the lazy dog',
    expected: 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
  },
]

describe('sha256Hex', () => {
  it.each(digests)('hashes $input to the FIPS 180-4 vector', ({ input, expected }) => {
    expect(sha256Hex(new TextEncoder().encode(input))).toBe(expected)
  })

  it('hashes a payload longer than one 64-byte chunk', () => {
    expect(sha256Hex(new TextEncoder().encode('a'.repeat(1000)))).toHaveLength(64)
  })
})

describe('canonicalJson', () => {
  it('sorts nested keys', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })

  it('drops undefined members and keeps null for undefined array items', () => {
    expect(canonicalJson({ a: undefined, b: [undefined, 1] })).toBe('{"b":[null,1]}')
  })

  it('rejects non-finite numbers and non-plain objects', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(TypeError)
    expect(() => canonicalJson(new Date(0))).toThrow(TypeError)
  })
})

describe('hashOf', () => {
  it('ignores key order', () => {
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }))
  })

  it('changes when a value changes', () => {
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }))
  })
})
