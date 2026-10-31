import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ERunner, type ThreadId } from '@dltech/atlas-core'
import type { PodBridgeDriver } from '@dltech/atlas-harness'
import { createDesktopHost } from '../../index'
import { SESSION_COOKIE } from '../../guard'
import { createTokenStore } from '../../auth/token-store'
import { openLocalStore } from '../local-store'

const SECRET = 'c'.repeat(64)

type Inspection = Awaited<ReturnType<PodBridgeDriver['inspect']>>

export function createResourceHost() {
  const home = mkdtempSync(join(tmpdir(), 'atlas-mac-resources-'))
  const authHome = join(home, 'desktop-auth')
  const store = openLocalStore({ home })
  const state = {
    inspection: { state: 'running', url: '' } as Inspection,
    resources: {} as { vcpus?: number; memoryMb?: number },
    inspectError: undefined as Error | undefined,
    readError: undefined as Error | undefined,
    resizeError: undefined as Error | undefined,
    inspected: [] as string[],
    reads: [] as string[],
    updates: [] as { name: string; vcpus: number }[],
    creates: 0,
    bootstraps: 0,
    destroys: 0,
    leases: 0,
    dials: 0,
  }
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => {
      if (request.headers.get('upgrade') === 'websocket') state.dials += 1
      else state.leases += 1
      return Response.json({ result: { data: null } })
    },
  })
  const origin = `http://127.0.0.1:${upstream.port}`
  state.inspection = { state: 'running', url: origin }
  const driver: PodBridgeDriver = {
    inspect: async ({ name }) => {
      state.inspected.push(name)
      if (state.inspectError !== undefined) throw state.inspectError
      return state.inspection
    },
    readResources: async ({ name }) => {
      state.reads.push(name)
      if (state.readError !== undefined) throw state.readError
      return state.resources
    },
    updateResources: async (args) => {
      state.updates.push(args)
      if (state.resizeError !== undefined) throw state.resizeError
    },
    createOrResume: async () => {
      state.creates += 1
      return { state: 'running', url: origin, created: true, token: SECRET }
    },
    writeBootstrapFile: async () => {
      state.bootstraps += 1
    },
    destroy: async () => {
      state.destroys += 1
    },
  }
  createTokenStore({ home: authHome }).save({ token: 'resource-test-bearer' })
  const previousHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const host = (() => {
    try {
      return createDesktopHost({
        webRoot: '/nonexistent',
        secret: SECRET,
        apiOrigin: origin,
        auth: { home: authHome },
        pods: { serveVersion: '1.2.3', driverWith: () => driver },
      })
    } finally {
      if (previousHome === undefined) delete process.env.ATLAS_HOME
      else process.env.ATLAS_HOME = previousHome
    }
  })()

  return {
    store,
    state,
    call: ({
      threadId,
      action = 'status',
      method = 'GET',
      body,
      cookie = `${SESSION_COOKIE}=${SECRET}`,
      rawBody,
    }: {
      threadId: string
      action?: string
      method?: string
      body?: unknown
      cookie?: string
      rawBody?: string
    }) =>
      fetch(`${host.url}/desktop/pods/${threadId}/${action}`, {
        method,
        headers: { cookie, 'content-type': 'application/json' },
        body: rawBody ?? (body === undefined ? null : JSON.stringify(body)),
      }),
    seed: async ({
      runner = ERunner.Local,
      projectId,
      agent,
    }: {
      runner?: ERunner | null
      projectId?: string
      agent?: { spawnedBy: ThreadId; type: string }
    } = {}) => {
      const record = await store.threads.create({ workspace: '/workspace', repo: null, agent })
      if (runner !== null) await store.threads.chooseRunner({ threadId: record.id, runner })
      if (projectId !== undefined) {
        await store.threads.chooseProject({ threadId: record.id, projectId })
      }
      return record.id
    },
    stop: async () => {
      await host.stop()
      upstream.stop(true)
      rmSync(home, { recursive: true, force: true })
    },
  }
}
