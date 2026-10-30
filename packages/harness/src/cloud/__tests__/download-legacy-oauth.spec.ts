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
import { trpcCallOf, trpcData, trpcError } from './accounts-trpc-fake'

const URL = 'https://cloud.test'
const clock: ClockPort = { now: () => '2026-10-05T12:00:00.000Z' }
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const remote = (args: {
  id: string
  refreshToken: string
  connectionId?: string
}): StoredAccount => ({
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
    tokens: {
      accessToken: 'fake-access',
      refreshToken: args.refreshToken,
      expiresAt: '2026-10-05T13:00:00.000Z',
    },
    ...(args.connectionId === undefined
      ? {}
      : { authority: { url: URL, connectionId: args.connectionId } }),
  },
})

const serviceFor = (backup: readonly StoredAccount[], active: string) => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-legacy-download-'))
  directories.push(directory)
  const sessions = new CloudSessionStore({
    file: join(directory, 'cloud.json'),
    keyFile: join(directory, 'key'),
  })
  sessions.write({ url: URL, token: 'fake-session', email: null })
  const local = memoryAccountStore({ clock })
  const requests: string[] = []
  const fetchFn: typeof fetch = Object.assign(
    async (input: string | URL | Request) => {
      const path = new globalThis.URL(String(input)).pathname
      requests.push(path)
      if (path.startsWith('/v1/trpc/accounts.')) {
        const call = trpcCallOf({ url: String(input) })
        const wanted = call.input as { provider?: string; accountId?: string } | undefined
        if (call.procedure === 'accounts.list')
          return trpcData(backup.map(({ secret: _secret, ...account }) => account))
        if (call.procedure === 'accounts.active')
          return trpcData({ accountId: wanted?.provider === 'anthropic' ? active : null })
        const held = backup.find((stored) => stored.id === wanted?.accountId)
        return held === undefined
          ? trpcError({ status: 404, message: 'no such account' })
          : trpcData(held)
      }
      if (path === '/v1/trpc/harnessSecrets.list') return trpcData({ secrets: [] })
      if (path === '/v1/trpc/mcpServers.list') return trpcData({ servers: [] })
      if (path === '/v1/trpc/settings.list') return trpcData({ settings: [] })
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
    handoffOauth: async (_session, ids) => {
      handoffs.push(ids)
    },
  })
  return { service, local, requests, handoffs }
}

describe('explicit backup download of OAuth accounts', () => {
  it('never resurrects a legacy raw refresh seed beside a current managed grant', async () => {
    const { service, local } = serviceFor(
      [remote({ id: 'acc_legacy', refreshToken: 'fake-legacy-seed' })],
      'acc_legacy',
    )
    const managed = await local.add({
      provider: EAuthProvider.Anthropic,
      origin: EAccountOrigin.Login,
      label: 'native',
      email: 'native@example.test',
      secret: {
        kind: EAuthKind.Oauth,
        tokens: {
          accessToken: 'fake-managed',
          refreshToken: '',
          expiresAt: '2026-10-05T13:00:00.000Z',
        },
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
    expect(
      stored?.secret.kind === EAuthKind.Oauth ? stored.secret.authority?.connectionId : undefined,
    ).toBe('oauth_cloud')
    expect(JSON.stringify(stored)).not.toContain('fake-legacy-seed')
    expect(handoffs).toHaveLength(1)
  })
})
