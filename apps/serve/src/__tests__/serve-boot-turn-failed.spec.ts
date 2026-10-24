import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '@dltech/atlas-core'
import { ETurnStatus, type WireEvent } from '@dltech/atlas-harness'
import { API_PROVISIONED_ENV, podEventsPostSchema } from '@dltech/atlas-wire'

import { EWorkspaceState, startServe, type ServeHandle } from '../index'

import { fakeServeApp } from './fakes'
import { trpcFailure, trpcOk, trpcUrl } from './trpc-fake'
import { inMemoryContextFiles } from './serve-spec-fixture'
import { scratchTranscriptStore } from './transcript-store-fixture'

const threadId = toThreadId('thread-boot-turn-failed')
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
  const rows: WireEvent[] = [userSaid({ seq: 1, text: 'hi', sendId: 'send-1' })]
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
    if (url.startsWith(`${controlPlaneUrl}/v1/threads/${threadId}/events`)) {
      return Response.json(rows)
    }
    if (url.startsWith(`${controlPlaneUrl}/v1/trpc/`)) return trpcOk(undefined)
    return new Response(null, { status: 204 })
  }) as unknown as typeof fetch
  return { rows, head, fetchFn }
}

const eventually = async (check: () => Promise<boolean> | boolean): Promise<void> => {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('the condition never held')
}

describe('a boot-resumed turn whose model step fails', () => {
  it('leaves an assistant-said error event that write-behind ships to Postgres', async () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-serve-boot-failed-'))
    homes.push(home)
    heldAtlasHome = process.env.ATLAS_HOME
    process.env.ATLAS_HOME = home
    const postgres = fakePostgres()
    const store = scratchTranscriptStore({ prefix: 'boot-failed', home })

    const handle = await startServe({
      threadId,
      port: 0,
      token: 'serve-token',
      controlPlaneUrl,
      env: { [API_PROVISIONED_ENV]: '1' },
      cwd: '/workspace',
      write: () => undefined,
      compose: async () => {
        const app = fakeServeApp({ threadId, root: '/workspace', intake: true, log: store.log })
        app.runner.resume = async () => ({
          status: ETurnStatus.Failed,
          runId: toRunId('run-failed'),
          message: 'Atlas Cloud holds no such OAuth connection. Sign in with /auth.',
          cause: undefined,
        })
        return app
      },
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      contextFiles: inMemoryContextFiles(),
      fetchFn: postgres.fetchFn,
    })
    running.push(handle)

    await eventually(() =>
      postgres.rows.some(
        (row) =>
          row.type === 'assistant-said' &&
          String(row.body).includes('Atlas Cloud holds no such OAuth connection'),
      ),
    )
    const local = await store.log.read({ threadId })
    const spoken = local.filter((event) => event.type === 'assistant-said')
    expect(spoken).toHaveLength(1)
  })
})
