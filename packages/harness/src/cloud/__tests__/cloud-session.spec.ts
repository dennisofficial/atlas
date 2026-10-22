import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CloudSessionStore } from '../cloud-session'

let directory: string
let store: CloudSessionStore

const file = () => join(directory, 'cloud.json')

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-cloud-session-'))
  store = new CloudSessionStore({ file: file(), keyFile: join(directory, 'key') })
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('CloudSessionStore', () => {
  it('reads back a session it wrote', () => {
    store.write({ url: 'http://localhost:3400', token: 'sess_token_1', email: 'a@b.c' })

    expect(store.read()).toEqual({
      url: 'http://localhost:3400',
      token: 'sess_token_1',
      email: 'a@b.c',
    })
  })

  it('roundtrips a null email', () => {
    store.write({ url: 'http://localhost:3400', token: 'sess_token_2', email: null })

    expect(store.read()?.email).toBeNull()
  })

  it('returns null when no session file exists', () => {
    expect(store.read()).toBeNull()
  })

  it('returns null for a file that is not JSON', () => {
    writeFileSync(file(), 'not json at all')

    expect(store.read()).toBeNull()
  })

  it('returns null when the sealed token cannot be opened', () => {
    writeFileSync(
      file(),
      JSON.stringify({
        version: 1,
        url: 'http://localhost:3400',
        email: null,
        sealedToken: 'not.a.sealed',
      }),
    )

    expect(store.read()).toBeNull()
  })

  it('writes the file owner-only', () => {
    store.write({ url: 'http://localhost:3400', token: 'sess_token_3', email: null })

    expect(statSync(file()).mode & 0o777).toBe(0o600)
  })

  it('never writes the token in plaintext', () => {
    store.write({ url: 'http://localhost:3400', token: 'sess_token_4', email: null })

    expect(readFileSync(file(), 'utf8')).not.toContain('sess_token_4')
  })

  it('clear removes the session', () => {
    store.write({ url: 'http://localhost:3400', token: 'sess_token_5', email: null })
    store.clear()

    expect(store.read()).toBeNull()
  })

  it('clear tolerates an absent file', () => {
    expect(() => store.clear()).not.toThrow()
  })
})
