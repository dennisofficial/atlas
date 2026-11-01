import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ERunner, toRunId, type ThreadId } from '@dltech/atlas-core'
import {
  podNameFor,
  sandboxServeTokenName,
  wireEventOf,
  type PodBridgeDriver,
} from '@dltech/atlas-harness'
import { createDesktopHost } from '../../index'
import { SESSION_COOKIE } from '../../guard'
import { openLocalStore } from '../local-store'
import { activitySocketFixture } from '../../../../../../packages/harness/src/activity/__tests__/activity-socket-fixture'

export { activitySocketFixture }

export async function localSummaryFixture() {
  const home = await mkdtemp(join(tmpdir(), 'atlas-mac-summary-'))
  const oldHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const store = openLocalStore({ home })
  const endpoints = new Map<string, string>()
  const socket = activitySocketFixture({
    snapshot: {
      runtimeId: 'runtime',
      revision: 0,
      turnEpoch: 0,
      working: false,
      awaiting: null,
      observedOutcome: null,
    },
  })
  let mutations = 0
  let inspections = 0
  const driver: PodBridgeDriver = {
    inspect: async ({ name }) => {
      inspections += 1
      const url = endpoints.get(name)
      if (url === 'error') throw new Error('unsafe-token-in-error')
      return url === undefined ? undefined : { state: 'running', url }
    },
    createOrResume: async () => {
      mutations += 1
      throw new Error('No passive provisioning')
    },
    writeBootstrapFile: async () => {
      mutations += 1
    },
    readResources: async () => ({}),
    updateResources: async () => {
      mutations += 1
    },
    destroy: async () => {
      mutations += 1
    },
  }
  const host = createDesktopHost({
    webRoot: '/nonexistent',
    secret: 'b'.repeat(64),
    auth: { home: join(home, 'auth') },
    pods: { driverWith: () => driver, serveVersion: '1.2.3', ping: async () => undefined },
  })
  const root = async (args: { title: string; endpoint?: string }) => {
    const record = await store.threads.create({ workspace: '/workspace', repo: null })
    await store.threads.chooseRunner({ threadId: record.id, runner: ERunner.Local })
    await store.threads.rename({ threadId: record.id, title: args.title })
    await store.log.append({
      threadId: record.id,
      runId: toRunId('seed'),
      drafts: [{ type: 'assistant-said', parts: [{ type: 'text', text: 'Known history' }] }],
    })
    if (args.endpoint !== undefined)
      endpoints.set(podNameFor({ threadId: record.id }), args.endpoint)
    if (args.endpoint === socket.url)
      socket.setEvents((await store.log.readOwn({ threadId: record.id })).map(wireEventOf))
    store.secrets.write({ name: sandboxServeTokenName(record.id), value: 'existing-token' })
    return record.id
  }
  return {
    home,
    store,
    host,
    socket,
    root,
    mutations: () => mutations,
    inspections: () => inspections,
    run: (args: { threadId: ThreadId; url: string }) => endpoints.set(podNameFor(args), args.url),
    call: (args: { path: string; method?: string; body?: unknown }) =>
      fetch(`${host.url}${args.path}`, {
        method: args.method ?? 'GET',
        headers: {
          cookie: `${SESSION_COOKIE}=${'b'.repeat(64)}; better-auth.session_token=test`,
          'content-type': 'application/json',
        },
        body: args.body === undefined ? null : JSON.stringify(args.body),
      }),
    async close() {
      await host.stop()
      await socket.stop()
      if (oldHome === undefined) delete process.env.ATLAS_HOME
      else process.env.ATLAS_HOME = oldHome
      await rm(home, { recursive: true, force: true })
    },
  }
}
