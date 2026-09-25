import { generateKeyPairSync, createVerify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { mintAppJwt, normalizePrivateKey } from './github-jwt'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const PUBLIC_PEM = publicKey.export({ type: 'pkcs1', format: 'pem' }).toString()

const decode = (segment: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>

describe('mintAppJwt', () => {
  it('mints an RS256 JWT that verifies against the app public key', () => {
    const jwt = mintAppJwt({ appId: '123456', privateKey: PRIVATE_PEM, nowSeconds: 1_800_000_000 })
    const [header, payload, signature] = jwt.split('.') as [string, string, string]

    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(decode(payload)).toEqual({
      iat: 1_800_000_000 - 60,
      exp: 1_800_000_000 + 540,
      iss: '123456',
    })

    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${header}.${payload}`)
    expect(verifier.verify(PUBLIC_PEM, signature, 'base64url')).toBe(true)
  })

  it('accepts a private key stored on one line with escaped newlines', () => {
    const escaped = PRIVATE_PEM.replaceAll('\n', '\\n')
    expect(escaped.includes('\n')).toBe(false)

    const jwt = mintAppJwt({ appId: '123456', privateKey: escaped, nowSeconds: 1_800_000_000 })
    const [header, payload, signature] = jwt.split('.') as [string, string, string]
    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${header}.${payload}`)
    expect(verifier.verify(PUBLIC_PEM, signature, 'base64url')).toBe(true)
  })
})

describe('normalizePrivateKey', () => {
  it('leaves a real PEM untouched', () => {
    expect(normalizePrivateKey(PRIVATE_PEM)).toBe(PRIVATE_PEM)
  })
})
