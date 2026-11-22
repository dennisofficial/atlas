import { describe, expect, it } from 'bun:test'

import { SecretCipher } from '../secret-cipher'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

describe('SecretCipher', () => {
  it('round-trips a value and produces a fresh iv each time', () => {
    const cipher = new SecretCipher(HEX_KEY)
    const first = cipher.encrypt('hunter2')
    expect(first.split('.')).toHaveLength(3)
    expect(cipher.decrypt(first)).toBe('hunter2')
    expect(cipher.encrypt('hunter2')).not.toBe(first)
  })

  it('accepts a base64 key of 32 bytes', () => {
    const key = Buffer.alloc(32, 7).toString('base64')
    expect(new SecretCipher(key).decrypt(new SecretCipher(key).encrypt('x'))).toBe('x')
  })

  it('rejects a key that does not decode to 32 bytes', () => {
    expect(() => new SecretCipher('abcd')).toThrow('32 bytes')
  })

  it('rejects a malformed blob and a tampered one', () => {
    const cipher = new SecretCipher(HEX_KEY)
    expect(() => cipher.decrypt('nope')).toThrow('malformed')
    const [iv, tag, body] = cipher.encrypt('secret').split('.') as [string, string, string]
    const flipped = Buffer.from(body, 'base64')
    flipped[0] = (flipped[0] ?? 0) ^ 1
    expect(() => cipher.decrypt([iv, tag, flipped.toString('base64')].join('.'))).toThrow()
  })

  it('does not decrypt under a different key', () => {
    const blob = new SecretCipher(HEX_KEY).encrypt('secret')
    expect(() => new SecretCipher('f'.repeat(64)).decrypt(blob)).toThrow()
  })
})
