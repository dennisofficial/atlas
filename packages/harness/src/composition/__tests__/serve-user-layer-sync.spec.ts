import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ATLAS_SETTINGS } from '@dltech/atlas-core'

import { CloudSessionStore } from '../../cloud/cloud-session'
import { ServeSessionToken } from '../../container/tokens'
import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { composeHarness } from '../compose'
import type { HarnessApp } from '../harness-app'
import { recordingNotices, testPortBindings } from './fakes'

let root: string
let atlasHome: string
let project: string
let previousAtlasHome: string | undefined
const opened: HarnessApp<undefined, never>[] = []

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-serve-ulsync-'))
  atlasHome = join(root, 'drive-home')
  project = join(root, 'project')
  previousAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = atlasHome
})

afterEach(async () => {
  for (const app of opened.splice(0)) await app.close()
  if (previousAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = previousAtlasHome
  await rm(root, { recursive: true, force: true })
})

const serveCompose = async (args?: {
  bindPorts?: (bind: { container: import('../../container/injection').DependencyContainer }) => void
}) => {
  const app = await composeHarness<undefined, never>({
    launch: { cwd: project, command: 'serve', model: undefined, executionLocation: undefined },
    env: {},
    settings: {
      service: createSettingsService({
        definitions: ATLAS_SETTINGS,
        user: new MemorySettingsStore({ label: 'serve user-layer sync spec' }),
      }),
      bindTo: () => {},
    },
    ports: testPortBindings(),
    clientVersion: 'serve-ulsync-spec',
    surface: { notice: recordingNotices().port },
    userLayerHome: atlasHome,
    ...(args?.bindPorts === undefined ? {} : { bindPorts: args.bindPorts }),
  })
  opened.push(app)
  return app
}

const recordCloud = (
  body: (input: { url: string; init?: RequestInit | undefined }) => Response | Promise<Response>,
) => {
  const calls: { url: string; method: string }[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' })
    return body({ url: String(input), init })
  }) as unknown as typeof fetch
  return { calls, restore: () => (globalThis.fetch = realFetch) }
}

const emptyLists = (): Response => Response.json({ result: { data: { files: [] } } })

describe('serve launch user-layer sync', () => {
  it('a Vercel-shaped serve with no pod name makes zero user-files calls', async () => {
    const cloud = recordCloud(emptyLists)
    const previousPodName = process.env.ATLAS_POD_NAME
    delete process.env.ATLAS_POD_NAME
    try {
      const app = await serveCompose({
        bindPorts: ({ container }) => {
          container.register(ServeSessionToken, {
            useValue: { url: 'https://cloud.test', token: 'sandbox-principal', email: null },
          })
        },
      })
      app.markActiveThread({ threadId: 'thread-opened', title: 'opened', started: false })
      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(cloud.calls.filter((call) => call.url.includes('/v1/trpc/userFiles.'))).toEqual([])
      expect(app.workspace.workspace.length).toBeGreaterThan(0)
    } finally {
      if (previousPodName !== undefined) process.env.ATLAS_POD_NAME = previousPodName
      cloud.restore()
    }
  })

  it('a local pod makes zero user-files calls either', async () => {
    const cloud = recordCloud(emptyLists)
    const previousPodName = process.env.ATLAS_POD_NAME
    process.env.ATLAS_POD_NAME = 'atlas-pod-spec'
    try {
      const app = await serveCompose({
        bindPorts: ({ container }) => {
          container.register(ServeSessionToken, {
            useValue: { url: 'https://cloud.test', token: 'pod-lease', email: null },
          })
        },
      })
      expect(cloud.calls.filter((call) => call.url.includes('/v1/trpc/userFiles.'))).toEqual([])
      expect(app.workspace.workspace.length).toBeGreaterThan(0)
    } finally {
      if (previousPodName === undefined) delete process.env.ATLAS_POD_NAME
      else process.env.ATLAS_POD_NAME = previousPodName
      cloud.restore()
    }
  })

  it('never opens a socket when no cloud authority exists', async () => {
    const cloud = recordCloud(() => {
      throw new Error('signed-out boot must not fetch')
    })

    try {
      const app = await serveCompose()
      expect(cloud.calls).toEqual([])
      expect(app.workspace.workspace.length).toBeGreaterThan(0)
    } finally {
      cloud.restore()
    }
  })

  it('prefers the stored cloud session on a non-serve launch and stays quiet until a conversation opens', async () => {
    const cloud = recordCloud(emptyLists)

    try {
      new CloudSessionStore({
        file: join(atlasHome, 'cloud.json'),
        keyFile: join(atlasHome, 'key'),
      }).write({ url: 'https://cloud.test', token: 'sess', email: null })

      const app = await composeHarness<undefined, never>({
        launch: {
          cwd: project,
          command: 'atlas-test',
          model: undefined,
          executionLocation: undefined,
        },
        env: {},
        settings: {
          service: createSettingsService({
            definitions: ATLAS_SETTINGS,
            user: new MemorySettingsStore({ label: 'serve user-layer sync spec' }),
          }),
          bindTo: () => {},
        },
        ports: testPortBindings(),
        clientVersion: 'serve-ulsync-spec',
        surface: { notice: recordingNotices().port },
      })
      opened.push(app)

      expect(cloud.calls).toEqual([])

      app.markActiveThread({ threadId: 'thread-opened', title: 'opened', started: false })
      const deadline = Date.now() + 5_000
      while (cloud.calls.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(
        cloud.calls.some((call) => call.url.startsWith('https://cloud.test/v1/trpc/userFiles.')),
      ).toBe(true)
    } finally {
      cloud.restore()
    }
  })
})
