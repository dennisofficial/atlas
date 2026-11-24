import { describe, expect, test } from 'bun:test'
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSecretCipher } from '../secret-cipher'
import { createSecretsStore } from '../secrets-store'
import { createTokenStore } from '../token-store'

const FIXTURE = join(import.meta.dir, 'fixtures', 'signed-in')
const SEALED = /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/

const homeOf = (): string => mkdtempSync(join(tmpdir(), 'atlas-mac-token-'))
const stagedIn = (dir: string): string[] => readdirSync(dir).filter((name) => name.endsWith('.tmp'))

describe('token store on a home the harness wrote', () => {
  test('reads the token, email and device id a signed-in Mac already holds', () => {
    const store = createTokenStore({ home: FIXTURE })
    expect(store.token()).toBe('fixture-token-abc123')
    expect(store.email()).toBe('dennis@example.com')
    expect(store.deviceId()).toBe('fixture-device-9f2c')
  })

  test('writes the version 1 secrets file the harness reads back', () => {
    const dir = homeOf()
    createTokenStore({ home: dir }).save({ token: 'tok-1', email: 'a@b.c' })
    const written = JSON.parse(readFileSync(join(dir, 'secrets.json'), 'utf8')) as {
      version: number
      secrets: Record<string, string>
    }
    expect(written.version).toBe(1)
    expect(Object.keys(written.secrets).sort()).toEqual([
      'desktop-cloud-email',
      'desktop-cloud-token',
    ])
    for (const sealed of Object.values(written.secrets)) expect(sealed).toMatch(SEALED)
  })
})

describe('token store', () => {
  test('round-trips a token, an email and a device id', () => {
    const dir = homeOf()
    const store = createTokenStore({ home: dir })
    expect(store.token()).toBeUndefined()

    store.save({ token: 'tok-1', email: 'a@b.c' })
    store.saveDeviceId('device-1')
    expect(store.token()).toBe('tok-1')
    expect(store.email()).toBe('a@b.c')
    expect(store.deviceId()).toBe('device-1')

    store.save({ token: 'tok-2' })
    expect(store.token()).toBe('tok-2')
    expect(store.email()).toBeUndefined()
    expect(store.deviceId()).toBe('device-1')

    store.clear()
    expect(store.token()).toBeUndefined()
    expect(store.email()).toBeUndefined()
    expect(store.deviceId()).toBe('device-1')
  })

  test('keeps the key file owner-only and 32 bytes of hex', () => {
    const dir = homeOf()
    createTokenStore({ home: dir }).save({ token: 'tok-1' })
    const key = join(dir, 'key')
    expect(readFileSync(key, 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/)
    expect(statSync(key).mode & 0o777).toBe(0o600)
    expect(statSync(join(dir, 'secrets.json')).mode & 0o777).toBe(0o600)
  })

  test('answers undefined for an unreadable file instead of throwing', () => {
    const dir = homeOf()
    mkdirSync(join(dir, 'secrets.json'))
    expect(createTokenStore({ home: dir }).token()).toBeUndefined()
  })
})

describe('atomic write', () => {
  test('renames a staged file over secrets.json, so the file is replaced not rewritten', () => {
    const dir = homeOf()
    const store = createTokenStore({ home: dir })
    store.save({ token: 'tok-1' })
    const file = join(dir, 'secrets.json')
    const held = openSync(file, 'r')

    store.save({ token: 'tok-2' })

    expect(readFileSync(held, 'utf8')).not.toBe(readFileSync(file, 'utf8'))
    closeSync(held)
    expect(stagedIn(dir)).toEqual([])
    expect(createTokenStore({ home: dir }).token()).toBe('tok-2')
  })

  test('stages beside the target and keeps the plaintext out of the staged file', () => {
    const dir = homeOf()
    mkdirSync(join(dir, 'secrets.json'))
    const store = createSecretsStore({
      file: join(dir, 'secrets.json'),
      keyFile: join(dir, 'key'),
    })
    expect(() => store.write({ name: 'desktop-cloud-token', value: 'tok-1' })).toThrow()

    const leftovers = stagedIn(dir)
    expect(leftovers).toHaveLength(1)
    const name = leftovers[0] ?? ''
    expect(name).toMatch(/^\.[0-9a-f-]{36}\.tmp$/)
    const body = readFileSync(join(dir, name), 'utf8')
    expect(body).not.toContain('tok-1')
    const written = JSON.parse(body) as { version: number; secrets: Record<string, string> }
    expect(written.secrets['desktop-cloud-token']).toMatch(SEALED)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('secret cipher', () => {
  test('rejects a blob whose tag does not match the ciphertext', () => {
    const dir = homeOf()
    const cipher = createSecretCipher({ keyFile: join(dir, 'key') })
    const [nonce = '', , ciphertext = ''] = cipher.encrypt('tok-1').split('.')
    const forged = [nonce, Buffer.alloc(16).toString('base64'), ciphertext].join('.')
    expect(() => cipher.decrypt(forged)).toThrow()
    expect(cipher.decrypt(cipher.encrypt('tok-1'))).toBe('tok-1')
  })
})
