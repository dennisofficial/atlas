import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { EAuthKind, EAuthProvider, ESettingId, toAccountId } from '@dltech/atlas-core'
import { encodeSettingValue, loadSettings } from '@dltech/atlas-harness'

import { EServeEvent } from '../serve-log'
import { apiKeyAccount, oauthAccount, SERVE_TOKEN } from './cloud-state-fixture'
import {
  accountStoreAt,
  apply,
  cleanupCloudState,
  cloudWith,
  secretsAt,
  tempHome,
} from './cloud-state-harness'

afterEach(cleanupCloudState)

describe('applyCloudState', () => {
  it('writes an auth.json, secrets.json and settings.json the file stores read back', async () => {
    const home = tempHome()
    const cloud = cloudWith({
      lease: {
        accounts: [
          apiKeyAccount({
            id: 'acc_or',
            provider: EAuthProvider.OpenRouter,
            apiKey: 'sk-or-fake',
            label: 'OpenRouter',
          }),
        ],
        active: [{ provider: EAuthProvider.OpenRouter, accountId: 'acc_or' }],
      },
      settings: [{ key: ESettingId.SidebarWidth, value: encodeSettingValue(42) }],
      secrets: [{ name: 'TAVILY_API_KEY', value: 'tvly-fake' }],
    })

    const lines = await apply({ home, cloud })

    const store = accountStoreAt(home)
    expect((await store.list()).map((account) => String(account.id))).toEqual(['acc_or'])
    expect(await store.activeFor(EAuthProvider.OpenRouter)).toBe(toAccountId('acc_or'))
    expect((await store.read(toAccountId('acc_or')))?.secret).toEqual({
      kind: EAuthKind.ApiKey,
      apiKey: 'sk-or-fake',
    })

    const secrets = secretsAt(home)
    expect(secrets.read('TAVILY_API_KEY')).toBe('tvly-fake')

    const previous = process.env.ATLAS_HOME
    process.env.ATLAS_HOME = home
    try {
      const settings = loadSettings({ env: {}, cwd: home })
      expect(
        settings.service.snapshot().resolution.settings.get(ESettingId.SidebarWidth)?.value,
      ).toBe(42)
      settings.service.close()
    } finally {
      if (previous === undefined) delete process.env.ATLAS_HOME
      else process.env.ATLAS_HOME = previous
    }

    expect(lines).toEqual([
      { event: EServeEvent.CloudStateReady, accounts: 1, secrets: 1, settings: 1 },
    ])
    expect(cloud.requests.map((request) => request.path).sort()).toEqual([
      '/v1/sandboxes/self/config',
      '/v1/secrets',
      '/v1/settings',
      '/v1/trpc/accountLease.get',
    ])
    expect(
      cloud.requests.every((request) => request.authorization === `Bearer ${SERVE_TOKEN}`),
    ).toBe(true)
  })

  it('writes the three files owner-only and never logs a value', async () => {
    const home = tempHome()
    const cloud = cloudWith({
      lease: {
        accounts: [
          apiKeyAccount({
            id: 'acc_or',
            provider: EAuthProvider.OpenRouter,
            apiKey: 'sk-or-secret',
            label: 'OR',
          }),
        ],
        active: [],
      },
      secrets: [{ name: 'TAVILY_API_KEY', value: 'tvly-secret' }],
    })

    const lines = await apply({ home, cloud })

    for (const name of ['auth.json', 'secrets.json', 'settings.json', 'key']) {
      expect(statSync(join(home, name)).mode & 0o777).toBe(0o600)
    }
    expect(JSON.stringify(lines)).not.toContain('sk-or-secret')
    expect(JSON.stringify(lines)).not.toContain('tvly-secret')
    expect(readFileSync(join(home, 'auth.json'), 'utf8')).not.toContain('sk-or-secret')
    expect(readFileSync(join(home, 'secrets.json'), 'utf8')).not.toContain('tvly-secret')
  })

  it('overwrites what an earlier boot left, so a resumed pod picks up keys added since', async () => {
    const home = tempHome()
    await apply({
      home,
      cloud: cloudWith({
        lease: {
          accounts: [
            apiKeyAccount({
              id: 'acc_old',
              provider: EAuthProvider.OpenRouter,
              apiKey: 'sk-old',
              label: 'Old',
            }),
          ],
          active: [{ provider: EAuthProvider.OpenRouter, accountId: 'acc_old' }],
        },
        settings: [{ key: ESettingId.SidebarWidth, value: encodeSettingValue(42) }],
        secrets: [{ name: 'STALE', value: 'stale' }],
      }),
    })
    expect(readFileSync(join(home, 'settings.json'), 'utf8')).toContain(ESettingId.SidebarWidth)

    await apply({
      home,
      cloud: cloudWith({
        lease: {
          accounts: [
            apiKeyAccount({
              id: 'acc_new',
              provider: EAuthProvider.OpenRouter,
              apiKey: 'sk-new',
              label: 'New',
            }),
          ],
          active: [{ provider: EAuthProvider.OpenRouter, accountId: 'acc_new' }],
        },
      }),
    })

    const store = accountStoreAt(home)
    expect((await store.list()).map((account) => String(account.id))).toEqual(['acc_new'])
    expect(await store.activeFor(EAuthProvider.OpenRouter)).toBe(toAccountId('acc_new'))
    const secrets = secretsAt(home)
    expect(secrets.names()).toEqual([])
    expect(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8'))).toEqual({})
  })

  it('keeps an OAuth account authority and its blank refresh token', async () => {
    const home = tempHome()
    const cloud = cloudWith({
      lease: {
        accounts: [oauthAccount({ id: 'acc_claude', connectionId: 'oauth_cloud' })],
        active: [{ provider: EAuthProvider.Anthropic, accountId: 'acc_claude' }],
      },
    })

    await apply({ home, cloud })

    const held = await accountStoreAt(home).read(toAccountId('acc_claude'))
    expect(held?.secret).toMatchObject({
      kind: EAuthKind.Oauth,
      tokens: { accessToken: 'fake-access', refreshToken: '' },
      authority: { url: 'https://cloud.test', connectionId: 'oauth_cloud' },
    })
  })

  it('drops lease entries this build cannot read and pointers to accounts it does not hold', async () => {
    const home = tempHome()
    const cloud = cloudWith({
      lease: {
        accounts: [
          apiKeyAccount({
            id: 'acc_or',
            provider: EAuthProvider.OpenRouter,
            apiKey: 'sk-or',
            label: 'OR',
          }),
          {
            ...apiKeyAccount({
              id: 'acc_future',
              provider: EAuthProvider.OpenRouter,
              apiKey: 'k',
              label: 'F',
            }),
            provider: 'future-provider',
          },
          { id: 'acc_broken' },
        ],
        active: [
          { provider: EAuthProvider.OpenRouter, accountId: 'acc_or' },
          { provider: 'future-provider', accountId: 'acc_future' },
          { provider: EAuthProvider.Anthropic, accountId: 'acc_missing' },
        ],
      },
    })

    const lines = await apply({ home, cloud })

    const store = accountStoreAt(home)
    expect((await store.list()).map((account) => String(account.id))).toEqual(['acc_or'])
    expect(await store.activeFor(EAuthProvider.OpenRouter)).toBe(toAccountId('acc_or'))
    expect(await store.activeFor(EAuthProvider.Anthropic)).toBeUndefined()
    expect(lines[0]).toMatchObject({ event: EServeEvent.CloudStateReady, accounts: 1 })
  })

  it('skips the client-held sandbox-serve and mcp-oauth secret names', async () => {
    const home = tempHome()
    const cloud = cloudWith({
      secrets: [
        { name: 'sandbox-serve:thread-1', value: 'serve-token' },
        { name: 'mcp-oauth:https://mcp.test/', value: '{}' },
        { name: 'TAVILY_API_KEY', value: 'tvly-fake' },
      ],
    })

    await apply({ home, cloud })

    const secrets = secretsAt(home)
    expect(secrets.names()).toEqual(['TAVILY_API_KEY'])
  })

  it('retries a 401 until the lease registers, then succeeds', async () => {
    const home = tempHome()
    const cloud = cloudWith({ secrets: [{ name: 'TAVILY_API_KEY', value: 'tvly-fake' }] })
    cloud.unauthorizedUntil.remaining = 2
    const sleeps: number[] = []

    const lines = await apply({
      home,
      cloud,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })

    expect(sleeps.length).toBeGreaterThan(0)
    expect(sleeps.every((ms) => ms === 2_000)).toBe(true)
    expect(lines.map((line) => line.event)).toEqual([EServeEvent.CloudStateReady])
  })

  it('stages nothing under the bootstrap directory', async () => {
    const home = tempHome()
    await apply({ home, cloud: cloudWith({}) })

    expect(existsSync(join(home, 'bootstrap'))).toBe(false)
  })
})
