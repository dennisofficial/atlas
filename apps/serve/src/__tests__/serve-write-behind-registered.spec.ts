import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '@dltech/atlas-core'
import { podEventOf, type WireEvent } from '@dltech/atlas-harness'
import {
  API_PROVISIONED_ENV,
  BOOT_STEP_EVENT_TYPE,
  MAX_POD_EVENTS_PER_FLUSH,
  podEventsPostSchema,
  type PodEvent,
} from '@dltech/atlas-wire'

import { EWorkspaceState, startServe, type ServeHandle } from '../index'
import { EServeEvent, type ServeLogLine } from '../serve-log'
import { bindServeWriteBehind } from '../serve-write-behind'

import { fakeServeApp, type FakeServeApp } from './fakes'
import { trpcFailure, trpcOk, trpcUrl } from './trpc-fake'
import { inMemoryContextFiles } from './serve-spec-fixture'
import { scratchTranscriptStore } from './transcript-store-fixture'

const threadId = toThreadId('thread-registered')
const controlPlaneUrl = 'https://api.example.com'
const registeredEnv = { ATLAS_CLOUD_URL: controlPlaneUrl, ATLAS_SERVE_TOKEN: 'serve-token' }
const homes: string[] = []
const running: ServeHandle[] = []
let heldAtlasHome: string | undefined

afterEach(async () => {
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
  while (running.length > 0) await running.pop()?.close()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const newHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-registered-'))
  homes.push(home)
  heldAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  return home
}

const wireRow = (event: PodEvent): WireEvent => ({ id: `pg-${event.seq}`, threadId, ...event })

const bootStepRow = (seq: number): WireEvent => ({
  id: `pg-${seq}`,
  threadId,
  seq,
  runId: 'run-boot',
  depth: 0,
  at: '2026-10-22T00:00:00.000Z',
  type: BOOT_STEP_EVENT_TYPE,
  body: JSON.stringify({ step: 'clone', state: 'done' }),
})

const fakePostgres = (seed: readonly WireEvent[] = []) => {
  const rows = new Map(seed.map((row) => [row.seq, row]))
  const batches: number[][] = []
  const conflicts: number[] = []
  const head = () => Math.max(0, ...rows.keys())
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === trpcUrl({ controlPlaneUrl, procedure: 'sandboxSelf.events' })) {
      const { events } = podEventsPostSchema.parse(JSON.parse(String(init?.body)))
      batches.push(events.map((event) => event.seq))
      for (const event of events) {
        const stored = rows.get(event.seq)
        const identical = stored !== undefined && stored.body === event.body
        if (!identical && (stored !== undefined || event.seq <= head())) {
          conflicts.push(event.seq)
          return trpcFailure({ status: 409, details: { seq: event.seq } })
        }
        rows.set(event.seq, wireRow(event))
      }
      return trpcOk({ head: head() })
    }
    if (url.startsWith(`${controlPlaneUrl}/v1/threads/${threadId}/events`)) {
      return Response.json([...rows.values()])
    }
    return new Response(null, { status: 204 })
  }) as unknown as typeof fetch
  return { rows, batches, conflicts, head, fetchFn }
}

const eventually = async (check: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('the condition never held')
}

const seedLocal = async (args: { home: string; count: number }) => {
  const store = scratchTranscriptStore({ prefix: 'seed', home: args.home })
  await store.log.append({
    threadId,
    runId: toRunId('run-local'),
    drafts: Array.from({ length: args.count }, (_, index) => ({
      type: 'user-said' as const,
      text: `local ${index + 1}`,
    })),
  })
  return store
}

const startRegistered = async (args: { home: string; fetchFn: typeof fetch }) => {
  let app: FakeServeApp | undefined
  const handle = await startServe({
    threadId,
    port: 0,
    token: 'serve-token',
    controlPlaneUrl,
    env: registeredEnv,
    cwd: '/workspace',
    write: () => undefined,
    compose: async () => {
      const store = scratchTranscriptStore({ prefix: 'boot', home: args.home })
      app = fakeServeApp({ threadId, root: '/workspace', intake: true, log: store.log })
      return app
    },
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    contextFiles: inMemoryContextFiles(),
    fetchFn: args.fetchFn,
  })
  running.push(handle)
  return { app: () => app }
}

const flattened = (batches: readonly number[][]): number[] => batches.flat()
const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index)

describe('a registered (non api-provisioned) pod writes behind', () => {
  it('flushes a whole local log from seq 1 in bounded batches when Postgres is empty', async () => {
    const home = newHome()
    const total = MAX_POD_EVENTS_PER_FLUSH * 2 + 100
    await seedLocal({ home, count: total })
    const postgres = fakePostgres()

    await startRegistered({ home, fetchFn: postgres.fetchFn })
    await eventually(() => postgres.head() >= total)

    expect(postgres.conflicts).toEqual([])
    expect(flattened(postgres.batches).slice(0, total)).toEqual(range(1, total))
    expect(new Set(flattened(postgres.batches)).size).toBe(flattened(postgres.batches).length)
    expect(postgres.batches.every((batch) => batch.length <= MAX_POD_EVENTS_PER_FLUSH)).toBe(true)
  })

  it('ships only the seqs Postgres does not hold when it holds an identical prefix', async () => {
    const home = newHome()
    const store = await seedLocal({ home, count: 8 })
    const own = await store.log.readOwn({ threadId })
    const postgres = fakePostgres(own.slice(0, 3).map((event) => wireRow(podEventOf(event))))

    await startRegistered({ home, fetchFn: postgres.fetchFn })
    await eventually(() => postgres.head() >= 8)

    expect(postgres.conflicts).toEqual([])
    expect(flattened(postgres.batches).slice(0, 5)).toEqual(range(4, 8))
    expect(new Set(flattened(postgres.batches)).size).toBe(flattened(postgres.batches).length)
  })

  it('numbers the next local event past legacy boot-step rows and flushes it without a conflict', async () => {
    const home = newHome()
    const postgres = fakePostgres(range(1, 12).map(bootStepRow))

    const { app } = await startRegistered({ home, fetchFn: postgres.fetchFn })
    const live = app()
    if (live === undefined) throw new Error('serve never composed')
    const [appended] = await live.log.append({
      threadId,
      runId: toRunId('run-after'),
      drafts: [{ type: 'user-said', text: 'after the legacy rows' }],
    })
    live.channel.publisherFor({ threadId }).eventsAppended()
    await eventually(() => postgres.head() === 13)

    expect(appended?.seq).toBe(13)
    expect(postgres.conflicts).toEqual([])
    expect(flattened(postgres.batches)).toEqual([13])
  })
})

describe('park after a failed flush', () => {
  const bind = async (args: { env: Record<string, string>; status: number }) => {
    const home = newHome()
    const store = await seedLocal({ home, count: 2 })
    const lines: ServeLogLine[] = []
    const behind = bindServeWriteBehind({
      env: args.env,
      app: fakeServeApp({ threadId, root: '/workspace', intake: true, log: store.log }),
      threadId,
      durableHead: 0,
      remote: {
        controlPlaneUrl,
        token: 'serve-token',
        clientVersion: 'dev',
        fetchFn: (async () =>
          args.status === 200
            ? trpcOk({ head: 2 })
            : trpcFailure({ status: args.status })) as unknown as typeof fetch,
      },
      log: (line) => lines.push(line),
    })
    return { behind, lines }
  }

  it('lets a registered pod park when the control plane refuses its token, and says so', async () => {
    for (const status of [401, 403]) {
      const { behind, lines } = await bind({ env: registeredEnv, status })
      expect(await behind?.flush()).toBe(true)
      expect(lines.map((line) => line.event)).toContain(EServeEvent.EventFlushRefused)
    }
  })

  it('still refuses to park a registered pod on a conflict or a server failure', async () => {
    for (const status of [409, 500]) {
      const { behind } = await bind({ env: registeredEnv, status })
      expect(await behind?.flush()).toBe(false)
    }
  })

  it('keeps refusing the park of an api-provisioned pod on 401', async () => {
    const { behind } = await bind({ env: { [API_PROVISIONED_ENV]: '1' }, status: 401 })
    expect(await behind?.flush()).toBe(false)
  })

  it('does not write behind at all without a url and token in the environment', async () => {
    const { behind } = await bind({ env: {}, status: 200 })
    expect(behind).toBeUndefined()
  })
})
