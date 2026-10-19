import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { publicKeyLineOf } from './openssh-key'
import { generateKey } from './ssh-key.fixtures'

describe('publicKeyLineOf', () => {
  it('round-trips an ssh-keygen ed25519 key to its public line', () => {
    const key = generateKey({ type: 'ed25519' })

    expect(publicKeyLineOf({ privateKey: key.privateKey })).toBe(key.publicLine)
  })

  it('tolerates surrounding whitespace', () => {
    const key = generateKey({ type: 'ed25519' })

    expect(publicKeyLineOf({ privateKey: `\n${key.privateKey}\n\n` })).toBe(key.publicLine)
  })

  it('refuses an rsa key', () => {
    const key = generateKey({ type: 'rsa' })

    expect(() => publicKeyLineOf({ privateKey: key.privateKey })).toThrow(BadRequestException)
  })

  it('refuses an encrypted ed25519 key', () => {
    const key = generateKey({ type: 'ed25519', passphrase: 'hunter2' })

    expect(() => publicKeyLineOf({ privateKey: key.privateKey })).toThrow(BadRequestException)
  })

  it.each(['', 'garbage', '-----BEGIN OPENSSH PRIVATE KEY-----\n!!!\n-----END OPENSSH PRIVATE KEY-----'])(
    'refuses garbage %j',
    (privateKey) => {
      expect(() => publicKeyLineOf({ privateKey })).toThrow(BadRequestException)
    },
  )

  it('refuses a truncated key', () => {
    const key = generateKey({ type: 'ed25519' })
    const lines = key.privateKey.trim().split('\n')
    const truncated = [lines[0], lines[1]?.slice(0, 40), lines[lines.length - 1]].join('\n')

    expect(() => publicKeyLineOf({ privateKey: truncated })).toThrow(BadRequestException)
  })
})
