import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ATLAS_SETTINGS } from '@dltech/atlas-core'

import { CLOUD_SETTING_DEFINITIONS, isCloudSettingId } from '../../cloud/settings-definitions'
import { UserSettingsStoreToken } from '../../container/tokens'
import { startGatedMcpServer, type GatedMcpServer } from '../../mcp/registry/__tests__/gated-server'
import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { composeHarness } from '../compose'
import type { SettingsBinding } from '../settings-binding'
import { recordingNotices, testPortBindings } from './fakes'

let project: string
let atlasHome: string
let previousAtlasHome: string | undefined
let server: GatedMcpServer

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'atlas-overlap-project-'))
  atlasHome = await mkdtemp(join(tmpdir(), 'atlas-overlap-home-'))
  previousAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = atlasHome
})

afterEach(async () => {
  server.stop()
  if (previousAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = previousAtlasHome
  await rm(project, { recursive: true, force: true })
  await rm(atlasHome, { recursive: true, force: true })
})

const settingsBinding = (): SettingsBinding => {
  const service = createSettingsService({
    definitions: [
      ...ATLAS_SETTINGS.filter((definition) => !isCloudSettingId(definition.id)),
      ...CLOUD_SETTING_DEFINITIONS,
    ],
    user: new MemorySettingsStore({ label: 'overlap spec' }),
  })
  const store = new MemorySettingsStore({ label: 'overlap spec store' })
  return {
    service,
    bindTo: (container) => {
      container.register(UserSettingsStoreToken, { useValue: store })
    },
  }
}

const startWithServer = async (status: number) => {
  server = startGatedMcpServer({ status })
  await writeFile(
    join(project, '.mcp.json'),
    JSON.stringify({ mcpServers: { slow: { type: 'http', url: server.url } } }),
  )
  const notices = recordingNotices()
  let reachedStores: () => void = () => undefined
  const reached = new Promise<void>((resolve) => {
    reachedStores = resolve
  })
  let settled = false
  const composed = composeHarness<undefined, never>({
    launch: { cwd: project, command: 'atlas-test', model: undefined, executionLocation: undefined },
    env: {},
    settings: settingsBinding(),
    ports: testPortBindings(),
    clientVersion: 'compose-spec',
    surface: { notice: notices.port },
    stores: { bind: () => reachedStores() },
  }).then((app) => {
    settled = true
    return app
  })
  return { notices, reached, composed, isSettled: () => settled }
}

describe('composeHarness MCP overlap', () => {
  it('reaches skills and stores binding while MCP connects, and resolves only after', async () => {
    const run = await startWithServer(200)

    await run.reached
    expect(run.isSettled()).toBe(false)

    server.release()
    const app = await run.composed

    expect(app.mcp().map((status) => status.spec.name)).toEqual(['slow'])
    await app.close()
  })

  it('still reports a failed server with the same notice and status', async () => {
    const run = await startWithServer(500)

    await run.reached
    server.release()
    const app = await run.composed

    expect(run.notices.posts.map((post) => post.key)).toContain('mcp:slow')
    expect(run.notices.posts.find((post) => post.key === 'mcp:slow')?.text).toStartWith(
      'slow Failed(',
    )
    await app.close()
  })
})
