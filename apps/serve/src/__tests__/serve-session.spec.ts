import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'bun:test'

import { CloudSessionStore } from '@dltech/atlas-harness/src/cloud/cloud-session'
import { atlasCloudFile, atlasVaultKeyFile } from '@dltech/atlas-harness/src/credentials/paths'
import { seedServeSession } from '../serve-session'

const storeOf = (): CloudSessionStore =>
  new CloudSessionStore({ file: atlasCloudFile(), keyFile: atlasVaultKeyFile() })

describe('seeding the sandbox cloud session', () => {
  beforeEach(() => {
    process.env.ATLAS_HOME = mkdtempSync(join(tmpdir(), 'atlas-serve-session-'))
  })

  it('leaves the session token readable by a fresh store, so the proxies go remote', () => {
    seedServeSession({ url: 'https://api.example.com', token: 'sandbox-token' })

    expect(storeOf().read()).toEqual({
      url: 'https://api.example.com',
      token: 'sandbox-token',
      email: null,
    })
  })

  it('reseeds over its own earlier sandbox session on a restart', () => {
    seedServeSession({ url: 'https://api.example.com', token: 'first-token' })
    seedServeSession({ url: 'https://api.example.com', token: 'second-token' })

    expect(storeOf().read()?.token).toBe('second-token')
  })

  it('refuses to clobber a human sign-in when serve is booted against a real atlas home', () => {
    const human = { url: 'https://api.atlas.dev', token: 'human-token', email: 'me@example.com' }
    storeOf().write(human)

    expect(() => seedServeSession({ url: 'http://127.0.0.1:1', token: 't' })).toThrow(
      /me@example\.com/,
    )
    expect(storeOf().read()).toEqual(human)
  })
})
