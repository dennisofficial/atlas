import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ATLAS_SETTINGS, ESettingId, EToolEffect, toThreadId, type ToolOutcome } from '@dltech/atlas-core'

import { ToolDefinition } from '@dltech/atlas-core'
import { z } from 'zod'

import { CloudSessionStore } from '../../cloud/cloud-session'
import { portToken } from '../../container/injection'
import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { composeHarness } from '../compose'
import type { HarnessApp, HarnessSurfaceBinding } from '../harness-app'
import type { SettingsBinding } from '../settings-binding'
import { recordingNotices } from './fakes'

let project: string
let atlasHome: string
let previousAtlasHome: string | undefined

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'atlas-compose-project-'))
  atlasHome = await mkdtemp(join(tmpdir(), 'atlas-compose-home-'))
  previousAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = atlasHome
})

afterEach(async () => {
  if (previousAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = previousAtlasHome
  await rm(project, { recursive: true, force: true })
  await rm(atlasHome, { recursive: true, force: true })
})

const settingsBinding = (): SettingsBinding => {
  const service = createSettingsService({
    definitions: ATLAS_SETTINGS,
    user: new MemorySettingsStore({ label: 'compose spec' }),
  })
  return { service, bindTo: () => {} }
}

const compose = <TSurface = undefined>(args?: {
  bind?: HarnessSurfaceBinding<TSurface>['bind']
}): Promise<HarnessApp<TSurface, never>> =>
  composeHarness<TSurface, never>({
    launch: { cwd: project, command: 'atlas-test', model: undefined, executionLocation: undefined },
    env: {},
    settings: settingsBinding(),
    clientVersion: 'compose-spec',
    surface: { notice: recordingNotices().port, ...(args?.bind === undefined ? {} : { bind: args.bind }) },
  })

describe('composeHarness', () => {
  it('composes a workspace-less session for an orchestrator with no project', async () => {
    const app = await composeHarness<undefined, never>({
      launch: { cwd: undefined, command: 'atlas-test', model: undefined, executionLocation: undefined },
      env: {},
      settings: settingsBinding(),
      clientVersion: 'compose-spec',
      surface: { notice: recordingNotices().port },
    })

    expect(app.launch.cwd).toBeUndefined()
    expect(app.workspace.repo).toBeNull()
    expect(app.tools.declarations().length).toBeGreaterThan(0)

    await expect(app.close()).resolves.toBeUndefined()
  })

  it('composes a working session against a bare project and closes cleanly', async () => {
    const app = await compose()

    expect(app.workspace.workspace).toBe(await realpath(project))
    expect(app.tools.declarations().length).toBeGreaterThan(0)
    expect(app.mcp()).toEqual([])
    expect(app.skills.length).toBeGreaterThan(0)
    expect(typeof app.runner.runTurn).toBe('function')

    await expect(app.close()).resolves.toBeUndefined()
  })

  it('runs the surface binding before the tool registry resolves, so bound tools ship', async () => {
    const app = await compose<{ bound: true }>({
      bind: ({ container }) => {
        container.register(portToken(ToolDefinition), {
          useValue: {
            name: 'surface-marker',
            description: 'proves the surface bound in time',
            effect: EToolEffect.Read,
            inputSchema: z.object({}),
            invoke: async (): Promise<ToolOutcome> => ({ ok: true, modelText: 'marked', output: {} }),
          },
        })
        return { bound: true }
      },
    })

    expect(app.surface).toEqual({ bound: true })
    expect(app.tools.find('surface-marker')?.description).toBe('proves the surface bound in time')

    await app.close()
  })

  it('queues typed input per thread until a turn drains it', async () => {
    const app = await compose()
    const threadId = toThreadId('compose-smoke')

    app.pending.forThread({ threadId }).enqueue({ text: 'typed ahead' })
    app.pending.forThread({ threadId: toThreadId('other') }).enqueue({ text: 'elsewhere' })

    expect(app.pending.forThread({ threadId }).drain().map((said) => said.text)).toEqual([
      'typed ahead',
    ])
    expect(app.pending.waitingCount()).toBe(1)

    await app.close()
  })

  it('composes through a cloud outage: signed in, every call 504s, boot degrades instead of dying', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = ((_input: unknown, _init?: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'gateway timeout' }), {
          status: 504,
          headers: { 'content-type': 'application/json' },
        }),
      )) as typeof fetch

    try {
      new CloudSessionStore({
        file: join(atlasHome, 'cloud.json'),
        keyFile: join(atlasHome, 'key'),
      }).write({ url: 'https://cloud.test', token: 'sess', email: null })

      const notices = recordingNotices()
      const app = await composeHarness<undefined, never>({
        launch: { cwd: project, command: 'atlas-test', model: undefined, executionLocation: undefined },
        env: {},
        settings: settingsBinding(),
        clientVersion: 'compose-spec',
        surface: { notice: notices.port },
      })

      expect(app.workspace.workspace).toBe(await realpath(project))
      expect(notices.posts.some((post) => post.text.includes('Atlas Cloud is unreachable'))).toBe(
        true,
      )

      await expect(app.close()).resolves.toBeUndefined()
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
