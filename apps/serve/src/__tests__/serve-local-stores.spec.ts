import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
  ESettingId,
  type ClockPort,
} from '@dltech/atlas-core'

import {
  AnthropicOauthClient,
  encodeSettingValue,
  fileAccountStore,
  FileSecretsStore,
  loadSettings,
  RefreshingCredentialPort,
  resolveMcpSpecs,
  SecretCipher,
} from '@dltech/atlas-harness'

import { applyCloudState } from '../cloud-state'
import { EServeEvent } from '../serve-log'
import { apiKeyAccount, SERVE_TOKEN, startFakeCloud } from './cloud-state-fixture'

const clock: ClockPort = { now: () => new Date().toISOString() }

const homes: string[] = []

const tempHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-local-'))
  homes.push(home)
  return home
}

const bootFromCloud = async (): Promise<string> => {
  const target = tempHome()
  const cloud = startFakeCloud({
    lease: {
      accounts: [
        apiKeyAccount({
          id: 'acc_anthropic',
          provider: EAuthProvider.Anthropic,
          apiKey: 'sk-ant-fake-birth',
          label: 'Anthropic (ANTHROPIC_API_KEY)',
        }),
      ],
      active: [{ provider: EAuthProvider.Anthropic, accountId: 'acc_anthropic' }],
    },
    settings: [{ key: ESettingId.SidebarWidth, value: encodeSettingValue(42) }],
    secrets: [{ name: 'TAVILY_API_KEY', value: 'tvly-fake-birth' }],
  })
  try {
    const events: string[] = []
    await applyCloudState({
      atlasHome: target,
      controlPlaneUrl: cloud.url,
      token: SERVE_TOKEN,
      clientVersion: '0.0.0-test',
      fetchFn: fetch,
      log: (line) => events.push(line.event),
    })
    expect(events).toEqual([EServeEvent.CloudStateReady])
  } finally {
    await cloud.stop()
  }
  writeFileSync(
    join(target, 'mcp.json'),
    '{"fake-local":{"transport":{"kind":"stdio","command":"definitely-not-a-real-command"}}}\n',
  )
  return target
}

afterEach(() => {
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
})

describe('serve local stores after the cloud pull', () => {
  it('reads the leased account as a usable credential', async () => {
    const target = await bootFromCloud()

    const store = fileAccountStore({
      file: join(target, 'auth.json'),
      keyFile: join(target, 'key'),
      clock,
    })
    const accounts = await store.list()
    expect(accounts.map((account) => account.label)).toEqual(['Anthropic (ANTHROPIC_API_KEY)'])
    expect(accounts[0]?.origin).toBe(EAccountOrigin.Login)

    const port = new RefreshingCredentialPort({
      accounts: store,
      clients: {},
      clock,
    })
    const heldId = accounts[0]?.id
    if (heldId === undefined) throw new Error('the leased account did not install')

    const credential = await port.read({ provider: EAuthProvider.Anthropic })
    expect(credential).toEqual({
      kind: EAuthKind.ApiKey,
      accountId: heldId,
      apiKey: 'sk-ant-fake-birth',
    })
  })

  it('reads search secrets, settings and MCP specs off the pulled home', async () => {
    const target = await bootFromCloud()

    const secrets = new FileSecretsStore({
      file: join(target, 'secrets.json'),
      cipher: new SecretCipher(join(target, 'key')),
    })
    expect(secrets.read('TAVILY_API_KEY')).toBe('tvly-fake-birth')

    const previous = process.env.ATLAS_HOME
    process.env.ATLAS_HOME = target
    try {
      const settings = loadSettings({ env: {}, cwd: target })
      const resolved = settings.service.snapshot().resolution.settings.get(ESettingId.SidebarWidth)
      expect(resolved?.value).toBe(42)
      settings.service.close()

      const mcp = await resolveMcpSpecs({ sources: [] })
      expect(mcp.rejections).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.ATLAS_HOME
      else process.env.ATLAS_HOME = previous
    }
  })

  it('refreshes an independently installed OAuth grant straight at the provider with the API rejecting and hung', async () => {
    const target = tempHome()
    const store = fileAccountStore({
      file: join(target, 'auth.json'),
      keyFile: join(target, 'key'),
      clock,
    })
    const account = await store.add({
      provider: EAuthProvider.Anthropic,
      label: 'Sandbox login',
      secret: {
        kind: EAuthKind.Oauth,
        tokens: {
          accessToken: 'fake-sandbox-access-0',
          refreshToken: 'fake-sandbox-refresh-0',
          expiresAt: '2020-01-01T00:00:00.000Z',
        },
      },
      origin: EAccountOrigin.Login,
    })

    const refreshCalls: string[] = []
    const port = new RefreshingCredentialPort({
      accounts: store,
      clients: {
        [EAuthProvider.Anthropic]: new AnthropicOauthClient({
          clock,
          fetch: async (input, init) => {
            expect(input).toBe('https://platform.claude.com/v1/oauth/token')
            refreshCalls.push(String(init.body))
            return Response.json({
              access_token: 'fake-sandbox-access-1',
              refresh_token: 'fake-sandbox-refresh-1',
              expires_in: 3600,
            })
          },
        }),
      },
      clock,
    })

    const credential = await port.read({ provider: EAuthProvider.Anthropic })

    expect(credential).toMatchObject({
      kind: EAuthKind.Oauth,
      accessToken: 'fake-sandbox-access-1',
    })
    expect(refreshCalls).toHaveLength(1)
    expect(refreshCalls[0]).toContain('fake-sandbox-refresh-0')

    const held = await store.read(account.id)
    expect(held?.secret).toEqual({
      kind: EAuthKind.Oauth,
      tokens: {
        accessToken: 'fake-sandbox-access-1',
        refreshToken: 'fake-sandbox-refresh-1',
        expiresAt: expect.any(String),
      },
    })
  })

  it('keeps rotated tokens across a serve restart', async () => {
    const target = tempHome()
    const firstStore = fileAccountStore({
      file: join(target, 'auth.json'),
      keyFile: join(target, 'key'),
      clock,
    })
    const account = await firstStore.add({
      provider: EAuthProvider.Anthropic,
      label: 'Sandbox login',
      secret: {
        kind: EAuthKind.Oauth,
        tokens: {
          accessToken: 'fake-sandbox-access-0',
          refreshToken: 'fake-sandbox-refresh-0',
          expiresAt: '2020-01-01T00:00:00.000Z',
        },
      },
      origin: EAccountOrigin.Login,
    })

    const issuer = new AnthropicOauthClient({
      clock,
      fetch: async () =>
        Response.json({
          access_token: 'fake-sandbox-access-1',
          refresh_token: 'fake-sandbox-refresh-1',
          expires_in: 3600,
        }),
    })
    const firstPort = new RefreshingCredentialPort({
      accounts: firstStore,
      clients: { [EAuthProvider.Anthropic]: issuer },
      clock,
    })
    await firstPort.read({ provider: EAuthProvider.Anthropic })

    const secondStore = fileAccountStore({
      file: join(target, 'auth.json'),
      keyFile: join(target, 'key'),
      clock,
    })
    const secondPort = new RefreshingCredentialPort({
      accounts: secondStore,
      clients: {
        [EAuthProvider.Anthropic]: new AnthropicOauthClient({
          clock,
          fetch: async () => {
            throw new Error('the rotated pair must survive without another refresh')
          },
        }),
      },
      clock,
    })

    const credential = await secondPort.read({ provider: EAuthProvider.Anthropic })
    expect(credential).toMatchObject({
      kind: EAuthKind.Oauth,
      accessToken: 'fake-sandbox-access-1',
    })

    const held = await secondStore.read(account.id)
    expect(held?.secret.kind).toBe(EAuthKind.Oauth)
  })
})
