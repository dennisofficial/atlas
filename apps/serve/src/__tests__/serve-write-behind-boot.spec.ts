import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import type { WireEvent } from '@dltech/atlas-harness'
import { API_PROVISIONED_ENV, podEventsPostSchema } from '@dltech/atlas-wire'

import { EWorkspaceState, startServe, type ServeHandle } from '../index'

import { fakeServeApp } from './fakes'
import { trpcFailure, trpcOk, trpcUrl } from './trpc-fake'
import { inMemoryContextFiles } from './serve-spec-fixture'
import { scratchTranscriptStore } from './transcript-store-fixture'

const threadId = toThreadId('thread-write-behind')
const controlPlaneUrl = 'https://api.example.com'
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

const userSaid = (args: { seq: number; text: string; sendId: string }): WireEvent => ({
  id: `pg-${args.seq}`,
  threadId,
  seq: args.seq,
  runId: 'run-web',
  depth: 0,
  at: '2026-10-22T00:00:00.000Z',
  type: 'user-said',
  body: JSON.stringify({ type: 'user-said', text: args.text, requestId: args.sendId }),
})

const fakePostgres = () => {
  const rows: WireEvent[] = []
  const head = () => rows.reduce((highest, row) => Math.max(highest, row.seq), 0)
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === trpcUrl({ controlPlaneUrl, procedure: 'sandboxSelf.events' })) {
      const { events } = podEventsPostSchema.parse(JSON.parse(String(init?.body)))
      for (const event of events) {
        if (event.seq !== head() + 1)
          return trpcFailure({ status: 409, details: { seq: event.seq } })
        rows.push({ id: `pg-${event.seq}`, threadId, ...event })
      }
      return trpcOk({ head: head() })
    }
    if (url.startsWith(trpcUrl({ controlPlaneUrl, procedure: 'threadEvents.read' }))) {
      return trpcOk(rows)
    }
    if (url.startsWith(`${controlPlaneUrl}/v1/trpc/`)) return trpcOk(undefined)
    return new Response(null, { status: 204 })
  }) as unknown as typeof fetch
  const appendFromApi = (args: { text: string; sendId: string }) =>
    rows.push(userSaid({ seq: head() + 1, ...args }))
  return { rows, head, fetchFn, appendFromApi }
}

const start = (args: { home: string; fetchFn: typeof fetch }) => {
  const store = scratchTranscriptStore({ prefix: 'wb', home: args.home })
  return {
    store,
    handle: startServe({
      threadId,
      port: 0,
      token: 'serve-token',
      controlPlaneUrl,
      env: { [API_PROVISIONED_ENV]: '1' },
      cwd: '/workspace',
      write: () => undefined,
      compose: async () =>
        fakeServeApp({ threadId, root: '/workspace', intake: true, log: store.log }),
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      contextFiles: inMemoryContextFiles(),
      fetchFn: args.fetchFn,
    }),
  }
}

const eventually = async (check: () => Promise<boolean> | boolean): Promise<void> => {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('the condition never held')
}

const answers = async (store: ReturnType<typeof start>['store']) =>
  (await store.log.read({ threadId })).filter((event) => event.type === 'assistant-said').length

describe('serve write-behind', () => {
  it('runs a message the API appended while the pod was parked once the pod wakes', async () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-serve-write-behind-'))
    homes.push(home)
    heldAtlasHome = process.env.ATLAS_HOME
    process.env.ATLAS_HOME = home
    const postgres = fakePostgres()
    postgres.appendFromApi({ text: 'first message', sendId: 'send-1' })

    const first = start({ home, fetchFn: postgres.fetchFn })
    const firstHandle = await first.handle
    await eventually(async () => (await answers(first.store)) === 1)
    await eventually(() => postgres.head() === 2)
    await firstHandle.close()

    postgres.appendFromApi({ text: 'sent while parked', sendId: 'send-2' })
    expect(postgres.rows.map((row) => [row.seq, row.type])).toEqual([
      [1, 'user-said'],
      [2, 'assistant-said'],
      [3, 'user-said'],
    ])

    const woken = start({ home, fetchFn: postgres.fetchFn })
    running.push(await woken.handle)
    await eventually(async () => (await answers(woken.store)) === 2)
    const local = await woken.store.log.read({ threadId })
    expect(local.map((event) => [event.seq, event.type])).toEqual([
      [1, 'user-said'],
      [2, 'assistant-said'],
      [3, 'user-said'],
      [4, 'assistant-said'],
    ])
    await eventually(() => postgres.head() === 4)
  })
})
