import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { EAuthProvider, ESettingId } from '@dltech/atlas-core'
import { encodeSettingValue } from '@dltech/atlas-harness'

import { EServeEvent } from '../serve-log'
import { apiKeyAccount } from './cloud-state-fixture'
import { accountStoreAt, apply, cleanupCloudState, cloudWith, secretsAt, tempHome } from './cloud-state-harness'

afterEach(cleanupCloudState)

describe('applyCloudState when the cloud never registers the token', () => {
  it('logs the failure and leaves what is on disk when a 401 outlasts the budget', async () => {
    const home = tempHome()
    await apply({
      home,
      cloud: cloudWith({
        lease: {
          accounts: [apiKeyAccount({ id: 'acc_or', provider: EAuthProvider.OpenRouter, apiKey: 'sk-or-fake', label: 'OR' })],
          active: [{ provider: EAuthProvider.OpenRouter, accountId: 'acc_or' }],
        },
        settings: [{ key: ESettingId.SidebarWidth, value: encodeSettingValue(42) }],
        secrets: [{ name: 'TAVILY_API_KEY', value: 'tvly-fake' }],
      }),
    })
    const files = ['auth.json', 'secrets.json', 'settings.json']
    const before = files.map((name) => readFileSync(join(home, name)))
    let clockMs = 0

    const lines = await apply({
      home,
      cloud: cloudWith({}),
      token: 'a-token-the-api-never-registered',
      now: () => clockMs,
      sleep: async (ms) => {
        clockMs += ms
      },
    })

    expect(lines.map((line) => line.event)).toEqual([EServeEvent.CloudStateFailed])
    files.forEach((name, index) => {
      expect(readFileSync(join(home, name)).equals(before[index] ?? Buffer.alloc(0))).toBe(true)
    })
    expect((await accountStoreAt(home).list()).map((account) => String(account.id))).toEqual(['acc_or'])
    expect(secretsAt(home).read('TAVILY_API_KEY')).toBe('tvly-fake')
    expect(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8'))).toEqual({ [ESettingId.SidebarWidth]: 42 })
    expect(clockMs).toBeLessThanOrEqual(60_000)
  })

  it('writes nothing when a 401 outlasts the budget on a fresh home', async () => {
    const home = tempHome()
    let clockMs = 0

    await apply({
      home,
      cloud: cloudWith({}),
      token: 'a-token-the-api-never-registered',
      now: () => clockMs,
      sleep: async (ms) => {
        clockMs += ms
      },
    })

    expect(existsSync(join(home, 'auth.json'))).toBe(false)
    expect(existsSync(join(home, 'secrets.json'))).toBe(false)
    expect(existsSync(join(home, 'settings.json'))).toBe(false)
  })
})
