import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
  type ClockPort,
} from '@dltech/atlas-core'

import { memoryAccountStore } from '../../credentials/account-store'
import { BrokeredCredentialPort } from '../../credentials/brokered-credential-port'
import { RefreshingCredentialPort } from '../../credentials/refreshing-credential-port'
import { CredentialPortProxy } from '../credential-port-proxy'
import { CloudSessionStore } from '../cloud-session'

const clock: ClockPort = { now: () => '2026-01-01T00:00:00.000Z' }

let directory: string
let sessions: CloudSessionStore
let fetchCalls: number
const realFetch = globalThis.fetch

const build = () => {
  const accounts = memoryAccountStore({ clock })
  const brokered = new BrokeredCredentialPort({ accounts, sessions })
  const local = new RefreshingCredentialPort({ accounts, clients: {}, clock })
  return new CredentialPortProxy({ local, sessions, brokered })
}

describe('CredentialPortProxy', () => {
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'atlas-cred-proxy-'))
    sessions = new CloudSessionStore({
      file: join(directory, 'cloud.json'),
      keyFile: join(directory, 'key'),
    })

    fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      return new Response(
        JSON.stringify({ accessToken: 'brokered', expiresAt: '2026-01-01T01:00:00.000Z' }),
        { status: 200 },
      )
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    rmSync(directory, { recursive: true, force: true })
  })

  it('never calls the cloud while signed out — the local port answers', async () => {
    const proxy = build()
    // the refusal is the local refreshing port's own message — proof the brokered
    // port never got the call
    await expect(proxy.read()).rejects.toThrow(/Atlas holds no accounts/)
    expect(fetchCalls).toBe(0)
  })

  it('reads through the broker while signed in — the proof is the network call', async () => {
    sessions.write({ url: 'https://cloud.test', token: 'sess', email: null })
    const accounts = memoryAccountStore({ clock })
    const added = await accounts.add({
      provider: EAuthProvider.Anthropic,
      label: 'cloud account',
      origin: EAccountOrigin.Login,
      secret: {
        kind: EAuthKind.Oauth,
        tokens: {
          accessToken: 'stored-access',
          refreshToken: 'stored-refresh',
          expiresAt: '2026-01-01T00:30:00.000Z',
        },
      },
    })
    await accounts.setActive({ provider: EAuthProvider.Anthropic, accountId: added.id })

    const brokered = new BrokeredCredentialPort({ accounts, sessions })
    const local = new RefreshingCredentialPort({ accounts, clients: {}, clock })
    const proxy = new CredentialPortProxy({ local, sessions, brokered })

    const credential = await proxy.read()

    expect(credential.kind).toBe(EAuthKind.Oauth)
    if (credential.kind !== EAuthKind.Oauth) throw new Error('expected oauth')
    expect(credential.accessToken).toBe('brokered')
    expect(fetchCalls).toBe(1)
  })
})
