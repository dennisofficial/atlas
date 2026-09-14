import { describe, expect, it } from 'vitest'
import { EnvService } from '@core/config/env/env.service'
import { SecretCipherService } from './secret-cipher.service'

const HEX_KEY =
  'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

function cipherWith(key: string): SecretCipherService {
  return new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: key }))
}

describe('SecretCipherService', () => {
  it('round-trips a secret through encrypt and decrypt', () => {
    const cipher = cipherWith(HEX_KEY)
    const blob = cipher.encrypt('sk-ant-oat-secret')
    expect(blob).not.toContain('sk-ant-oat-secret')
    expect(cipher.decrypt(blob)).toBe('sk-ant-oat-secret')
  })

  it('produces a fresh nonce per encryption', () => {
    const cipher = cipherWith(HEX_KEY)
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'))
  })

  it('accepts a 32-byte base64 key', () => {
    const cipher = cipherWith(Buffer.alloc(32, 7).toString('base64'))
    expect(cipher.decrypt(cipher.encrypt('payload'))).toBe('payload')
  })

  it('rejects a key that decodes to the wrong length', () => {
    expect(() => cipherWith('abcd')).toThrow(/32 bytes/)
  })

  it('fails decryption when the ciphertext is tampered with', () => {
    const cipher = cipherWith(HEX_KEY)
    const [iv, tag, ct] = cipher.encrypt('payload').split('.') as [string, string, string]
    const tampered = [iv, tag, Buffer.from(ct, 'base64').reverse().toString('base64')].join('.')
    expect(() => cipher.decrypt(tampered)).toThrow()
  })

  it('rejects malformed blobs', () => {
    const cipher = cipherWith(HEX_KEY)
    expect(() => cipher.decrypt('not-a-blob')).toThrow(/malformed/i)
  })
})
