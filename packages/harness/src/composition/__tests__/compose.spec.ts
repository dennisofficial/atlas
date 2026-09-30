import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ATLAS_SETTINGS, ESettingId, EToolEffect, toThreadId, type ToolOutcome } from '@dltech/atlas-core'

import { ToolDefinition } from '@dltech/atlas-core'
import { z } from 'zod'

import { CloudSessionStore } from '../../cloud/cloud-session'
import { CLOUD_SETTING_DEFINITIONS, isCloudSettingId } from '../../cloud/settings-definitions'
import { portToken, type DependencyContainer } from '../../container/injection'
import {
  ClaudeCodeSourceToken,
  CodexSourceToken,
  UserSettingsStoreToken,
} from '../../container/tokens'
import { ClaudeCodeSource } from '../../credentials/claude-code-source'
import { CodexSource } from '../../credentials/codex-source'
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
    definitions: [
      ...ATLAS_SETTINGS.filter((definition) => !isCloudSettingId(definition.id)),
      ...CLOUD_SETTING_DEFINITIONS,
    ],
    user: new MemorySettingsStore({ label: 'compose spec' }),
  })
  const store = new MemorySettingsStore({ label: 'compose spec store' })
  return {
    service,
    bindTo: (container) => {
      container.register(UserSettingsStoreToken, { useValue: store })
    },
  }
}

// A spec must never read the developer's real keychain or codex file; bindPorts swaps the import
// sources for silent ones before bindAccounts resolves them.
const silentImportSources = (args: { container: DependencyContainer }): void => {
  args.container.register(ClaudeCodeSourceToken, {
    useValue: new ClaudeCodeSource({ read: async () => undefined, write: async () => {} }),
  })
  args.container.register(CodexSourceToken, {
    useValue: new CodexSource({ file: join(atlasHome, 'no-codex-auth.json') }),
  })
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

  it('resolves the registered SelectableModel to the very switchable the loop holds', async () => {
    const { SelectableModelToken } = await import('../../container/tokens')
    let resolved: HarnessApp<never>['model'] | undefined
    const app = await compose<undefined>({
      bind: ({ container }) => {
        resolved = container.resolve(SelectableModelToken)
        return undefined
      },
    })

    expect(resolved).toBe(app.model)
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

  it('composes signed-in with a dead cloud fetch: local stores answer, boot is not blocked', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 30_000))
      return Response.json({})
    }) as unknown as typeof fetch

    try {
      new CloudSessionStore({
        file: join(atlasHome, 'cloud.json'),
        keyFile: join(atlasHome, 'key'),
      }).write({ url: 'https://cloud.test', token: 'sess', email: null })

      const started = Date.now()
      const app = await composeHarness<undefined, never>({
        launch: { cwd: project, command: 'atlas-test', model: undefined, executionLocation: undefined },
        env: {},
        settings: settingsBinding(),
        clientVersion: 'compose-spec',
        surface: { notice: recordingNotices().port },
        bindPorts: silentImportSources,
      })

      expect(Date.now() - started).toBeLessThan(10_000)
      expect(app.workspace.workspace).toBe(await realpath(project))
      expect(await app.accounts.list()).toEqual([])
      app.secrets.write({ name: 'search.tavily', value: 'tvly-fake' })
      expect(app.secrets.read('search.tavily')).toBe('tvly-fake')
      expect(app.settings.set({ id: ESettingId.VercelTeamId, value: 'team_local' })).toEqual({
        ok: true,
      })
      expect(
        app.settings.snapshot().resolution.settings.get(ESettingId.VercelTeamId)?.value,
      ).toBe('team_local')
      expect(app.legacySettingsRestore).toBeDefined()

      await expect(app.close()).resolves.toBeUndefined()
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('restores the sandbox configuration once from the cloud sign-in, then never again', async () => {
    const realFetch = globalThis.fetch
    const stamp = '2026-09-30T00:00:00.000Z'
    const fetches: string[] = []
    globalThis.fetch = (async (input: unknown) => {
      const path = String(input)
      fetches.push(path)
      if (path.endsWith('/v1/secrets')) {
        return Response.json({
          secrets: [{ name: ESettingId.VercelToken, value: 'vcp_remote', updatedAt: stamp }],
        })
      }
      if (path.endsWith('/v1/settings')) {
        return Response.json({
          settings: [
            { key: ESettingId.VercelTeamId, value: 'team_remote', updatedAt: stamp },
            { key: ESettingId.VercelProjectId, value: 'prj_remote', updatedAt: stamp },
          ],
        })
      }
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch

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
        bindPorts: silentImportSources,
      })

      const report = await app.legacySettingsRestore
      expect(report?.outcome).toBe('restored')
      expect(app.secrets.read(ESettingId.VercelToken)).toBe('vcp_remote')
      await expect(app.close()).resolves.toBeUndefined()

      const before = fetches.length
      expect(before).toBeGreaterThan(0)

      const second = await composeHarness<undefined, never>({
        launch: { cwd: project, command: 'atlas-test', model: undefined, executionLocation: undefined },
        env: {},
        settings: settingsBinding(),
        clientVersion: 'compose-spec',
        surface: { notice: recordingNotices().port },
        bindPorts: silentImportSources,
      })

      expect(second.legacySettingsRestore).toBeUndefined()
      expect(fetches.length).toBe(before)
      await expect(second.close()).resolves.toBeUndefined()
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('advises an explicit download when a cloud sign-in exists but the local vault is empty', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('cloud fetch must never fire')
    }) as unknown as typeof fetch

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
        bindPorts: silentImportSources,
      })

      expect(
        notices.posts.some(
          (post) =>
            post.key === 'cloud:legacy-accounts' && post.text.includes('cloud download'),
        ),
      ).toBe(true)

      await expect(app.close()).resolves.toBeUndefined()
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('stays quiet when the local vault is empty and no cloud sign-in exists', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('cloud fetch must never fire')
    }) as unknown as typeof fetch

    try {
      const notices = recordingNotices()
      const app = await composeHarness<undefined, never>({
        launch: { cwd: project, command: 'atlas-test', model: undefined, executionLocation: undefined },
        env: {},
        settings: settingsBinding(),
        clientVersion: 'compose-spec',
        surface: { notice: notices.port },
        bindPorts: silentImportSources,
      })

      expect(notices.posts.some((post) => post.key === 'cloud:legacy-accounts')).toBe(false)

      await expect(app.close()).resolves.toBeUndefined()
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
