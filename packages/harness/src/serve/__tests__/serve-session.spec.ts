import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { CloudSessionStore } from '../../cloud/cloud-session'
import { atlasCloudFile, atlasVaultKeyFile } from '../../credentials/paths'
import { seedServeSession } from '../serve-session'

describe('seeding the sandbox cloud session', () => {
  it('leaves the session token readable by a fresh store, so the proxies go remote', () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-serve-session-'))
    process.env.ATLAS_HOME = home

    seedServeSession({ url: 'https://api.example.com', token: 'sandbox-token' })

    const sessions = new CloudSessionStore({ file: atlasCloudFile(), keyFile: atlasVaultKeyFile() })
    expect(sessions.read()).toEqual({
      url: 'https://api.example.com',
      token: 'sandbox-token',
      email: null,
    })
  })
})
