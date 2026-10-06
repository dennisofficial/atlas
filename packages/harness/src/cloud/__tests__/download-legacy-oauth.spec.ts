import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  type ClockPort,
  type StoredAccount,
} from '@dltech/atlas-core'

import { memoryAccountStore } from '../../credentials/account-store'
import { CloudService } from '../cloud-service'
import { CloudSessionStore } from '../cloud-session'
import { openHome, seedSource } from './portable-state-fixture'

const URL = 'https://cloud.test'
const clock: ClockPort = { now: () => '2026-10-05T12:00:00.000Z' }
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const remote = (args: { id: string; refreshToken: string; connectionId?: string }): StoredAccount => ({
  id: args.id as StoredAccount['id'],
  provider: EAuthProvider.Anthropic,
  kind: EAuthKind.Oauth,
  origin: EAccountOrigin.Login,
  label: 'native',
  email: 'native@example.test',
  status: EAccountStatus.Active,
  createdAt: '2026-10-05T11:00:00.000Z',
  updatedAt: '2026-10-05T11:00:00.000Z',
  secret: {
    kind: EAuthKind.Oauth,
    tokens: { accessToken: 'fake-access', refreshToken: args.refreshToken, expiresAt: '2026-10-05T13:00:00.000Z' },
    ...(args.connectionId === undefined ? {} : { authority: { url: URL, connectionId: args.connectionId } }),
  },
})

const serviceFor = (backup: readonly StoredAccount[], active: string) => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-legacy-download-'))
  directories.push(directory)
  const sessions = new CloudSessionStore({ file: join(directory, 'cloud.json'), keyFile: join(directory, 'key') })
  sessions.write({ url: URL, token: 'fake-session', email: null })
  const local = memoryAccountStore({ clock })
  const requests: string[] = []
  const fetchFn: typeof fetch = Object.assign(
    async (input: string | URL | Request) => {
      const path = String(input).slice(URL.length)
      requests.push(path)
      if (path === '/v1/accounts') return Response.json(backup.map(({ secret: _secret, ...account }) => account))
      if (path === '/v1/accounts/active/anthropic') return Response.json({ accountId: active })
      if (path.startsWith('/v1/accounts/active/')) return Response.json({ accountId: null })
      if (path.startsWith('/v1/accounts/')) return Response.json(backup.find((stored) => `/v1/accounts/${stored.id}` === path))
      if (path === '/v1/secrets') return Response.json({ secrets: [] })
      if (path === '/v1/mcp-servers') return Response.json({ servers: [] })
      if (path === '/v1/settings') return Response.json({ settings: [] })
      return new Response(null, { status: 404 })
    },
    { preconnect: () => undefined },
  )
  const handoffs: unknown[] = []
  const service = new CloudService({
    sessions,
    localAccounts: local,
    defaultUrl: URL,
    fetchFn,
    signInOffer: { offered: () => true, markOffered: () => undefined },
    handoffOauth: async (_session, ids) => { handoffs.push(ids) },
  })
  return { service, local, requests, handoffs }
}

describe('explicit backup download of OAuth accounts', () => {
  it('never resurrects a legacy raw refresh seed beside a current managed grant', async () => {
    const { service, local } = serviceFor([remote({ id: 'acc_legacy', refreshToken: 'fake-legacy-seed' })], 'acc_legacy')
    const managed = await local.add({
      provider: EAuthProvider.Anthropic,
      origin: EAccountOrigin.Login,
      label: 'native',
      email: 'native@example.test',
      secret: {
        kind: EAuthKind.Oauth,
        tokens: { accessToken: 'fake-managed', refreshToken: '', expiresAt: '2026-10-05T13:00:00.000Z' },
        authority: { url: URL, connectionId: 'oauth_current' },
      },
    })
    await local.setActive({ provider: EAuthProvider.Anthropic, accountId: managed.id })

    const counts = await service.downloadCloudToLocal()

    expect(counts.accounts).toBe(0)
    const held = await local.list()
    expect(held.map((account) => account.id)).toEqual([managed.id])
    expect(await local.activeFor(EAuthProvider.Anthropic)).toBe(managed.id)
    const stored = await local.read(managed.id)
    expect(JSON.stringify(stored)).not.toContain('fake-legacy-seed')
  })

  it('keeps downloaded authority markers and never receives a raw seed', async () => {
    const { service, local, handoffs } = serviceFor(
      [remote({ id: 'acc_marker', refreshToken: '', connectionId: 'oauth_cloud' })],
      'acc_marker',
    )

    const counts = await service.downloadCloudToLocal()

    expect(counts.accounts).toBe(1)
    const [account] = await local.list()
    const stored = account === undefined ? undefined : await local.read(account.id)
    expect(stored?.secret.kind === EAuthKind.Oauth ? stored.secret.authority?.connectionId : undefined).toBe('oauth_cloud')
    expect(JSON.stringify(stored)).not.toContain('fake-legacy-seed')
    expect(handoffs).toHaveLength(1)
  })
})

describe('portable capture without an Atlas Cloud session', () => {
  it('omits every OAuth account rather than carrying authority-less copies', async () => {
    const source = openHome()
    directories.push(source.directory)
    const previous = process.env['ATLAS_HOME']
    process.env['ATLAS_HOME'] = source.directory
    try {
      await seedSource({ source })
      const sessions = new CloudSessionStore({ file: join(source.directory, 'cloud.json'), keyFile: join(source.directory, 'key') })
      const service = new CloudService({
        sessions,
        localAccounts: source.store,
        defaultUrl: URL,
        signInOffer: { offered: () => true, markOffered: () => undefined },
      })
      const state = await service.capturePortableState()
      expect(state.omitted?.oauthAccounts).toEqual(['Claude subscription'])
      expect(state.accounts.find((account) => account.label === 'Claude subscription')?.status).toBe('expired')
      expect(JSON.stringify(state)).not.toContain('fake-refresh-token')
    } finally {
      if (previous === undefined) delete process.env['ATLAS_HOME']
      else process.env['ATLAS_HOME'] = previous
    }
  })
})
