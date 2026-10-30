import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { ESettingId } from '@dltech/atlas-core'
import { encodeSettingValue, loadSettings } from '@dltech/atlas-harness'

import { createCloudStateRefresh } from '../cloud-state-refresh'
import { EServeEvent, type ServeLogLine } from '../serve-log'
import { cleanupCloudState, tempHome } from './cloud-state-harness'
import { EAuthProvider } from '@dltech/atlas-core'
import { apiKeyAccount, SERVE_TOKEN, startFakeCloud, type FakeCloud } from './cloud-state-fixture'

afterEach(cleanupCloudState)

const configWith = (width: number) => ({
  settings: { [ESettingId.SidebarWidth]: encodeSettingValue(width) },
  secrets: [],
  harnessSecrets: [],
  mcpServers: [],
  provenance: {},
})

const rig = (options: { secrets?: unknown[] } = {}) => {
  const home = tempHome()
  process.env.ATLAS_HOME = home
  const settings = loadSettings({ env: {}, cwd: home })
  const env: Record<string, string | undefined> = { INHERITED: 'from-image' }
  const state: {
    lease: unknown
    settings: never[]
    secrets: never[]
    harnessSecrets: never[]
    config: unknown
  } = {
    lease: { accounts: [], active: [] },
    settings: [],
    secrets: [],
    harnessSecrets: [],
    config: { ...configWith(50), secrets: options.secrets ?? [] },
  }
  const cloud: FakeCloud = startFakeCloud(state)
  const lines: ServeLogLine[] = []
  const refresh = createCloudStateRefresh({
    atlasHome: home,
    controlPlaneUrl: cloud.url,
    token: SERVE_TOKEN,
    clientVersion: '0.0.0-test',
    fetchFn: fetch,
    log: (line) => lines.push(line),
    projectId: null,
    env,
  })
  refresh.bindSettings(settings.service)
  const file = join(home, 'settings.json')
  return { state, cloud, lines, refresh, file, home, env, settings }
}

describe('per-turn Cloud refresh', () => {
  it('rewrites settings.json when the Cloud value changed', async () => {
    const { state, refresh, file, cloud } = rig()
    await refresh.boot()
    expect(readFileSync(file, 'utf8')).toContain('50')

    state.config = configWith(60)
    await refresh.refresh()

    expect(readFileSync(file, 'utf8')).toContain('60')
    await cloud.stop()
  })

  it('does not write when nothing changed', async () => {
    const { refresh, file, lines } = rig()
    await refresh.boot()
    const before = statSync(file).mtimeMs
    await Bun.sleep(15)

    await refresh.refresh()

    expect(statSync(file).mtimeMs).toBe(before)
    expect(lines.filter((l) => l.event === EServeEvent.CloudStateReady)).toHaveLength(1)
  })

  it('logs CloudStateFailed and leaves the file when Cloud is unreachable', async () => {
    const { refresh, file, lines, cloud } = rig()
    await refresh.boot()
    await cloud.stop()

    await expect(refresh.refresh()).resolves.toBeUndefined()

    expect(readFileSync(file, 'utf8')).toContain('50')
    expect(lines.at(-1)?.event).toBe(EServeEvent.CloudStateFailed)
  })

  it('makes the refreshed value visible to the settings service before refresh resolves', async () => {
    const { state, refresh, settings, cloud } = rig()
    await refresh.boot()
    const width = () =>
      settings.service.snapshot().resolution.settings.get(ESettingId.SidebarWidth)?.value
    expect(width()).toBe(50)

    state.config = configWith(60)
    await refresh.refresh()

    expect(width()).toBe(60)
    settings.service.close()
    await cloud.stop()
  })

  it('leaves the account vault alone when only the config changed', async () => {
    const { state, refresh, home, cloud } = rig()
    await refresh.boot()
    const vault = join(home, 'auth.json')
    writeFileSync(vault, 'rotated-by-the-pod')

    state.config = configWith(60)
    await refresh.refresh()

    expect(readFileSync(vault, 'utf8')).toBe('rotated-by-the-pod')
    expect(readFileSync(join(home, 'settings.json'), 'utf8')).toContain('60')
    await cloud.stop()
  })

  it('rewrites the vault when the lease changed', async () => {
    const { state, refresh, home, cloud } = rig()
    await refresh.boot()
    const vault = join(home, 'auth.json')
    writeFileSync(vault, 'stale')

    state.lease = {
      accounts: [
        apiKeyAccount({
          id: 'acc_or',
          provider: EAuthProvider.OpenRouter,
          apiKey: 'sk-or-new',
          label: 'OpenRouter',
        }),
      ],
      active: [],
    }
    await refresh.refresh()

    expect(readFileSync(vault, 'utf8')).not.toBe('stale')
    await cloud.stop()
  })

  it('updates and removes the env secrets it exported, never inherited ones', async () => {
    const envSecret = (name: string, value: string) => ({ name, value })
    const { state, refresh, env, cloud } = rig({
      secrets: [envSecret('DATABASE_URL', 'postgres://a'), envSecret('INHERITED', 'cloud')],
    })
    await refresh.boot()
    expect(env.DATABASE_URL).toBe('postgres://a')
    expect(env.INHERITED).toBe('from-image')

    state.config = {
      ...configWith(50),
      secrets: [envSecret('DATABASE_URL', 'postgres://b')],
    }
    await refresh.refresh()
    expect(env.DATABASE_URL).toBe('postgres://b')

    state.config = { ...configWith(50), secrets: [] }
    await refresh.refresh()
    expect(env.DATABASE_URL).toBeUndefined()
    expect(env.INHERITED).toBe('from-image')
    await cloud.stop()
  })
})
