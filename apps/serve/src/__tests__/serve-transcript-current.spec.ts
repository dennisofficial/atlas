import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import { EClientFrame, EServeFrame, type ServeFrame } from '@dltech/atlas-harness'

import { EWorkspaceState, startServe, type ServeHandle } from '../index'

import { connect, type TestClient } from './client'
import { fakeServeApp } from './fakes'
import { scratchTranscriptStore, type TranscriptStore } from './transcript-store-fixture'

const TOKEN = 'session-token'
const threadId = toThreadId('thread-vouch')

const homes: string[] = []
const running: ServeHandle[] = []
let heldAtlasHome: string | undefined

afterEach(async () => {
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
  while (running.length > 0) await running.pop()?.close()
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
})

const boot = async (args: {
  hello: { channelCursor: number | null; lastEventSeq: number }
  seed?: number | undefined
}): Promise<{ client: TestClient; store: TranscriptStore; ready: ServeFrame; port: number }> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-vouch-'))
  homes.push(home)
  heldAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const app = fakeServeApp({ threadId, root: '/workspace' })
  const store = scratchTranscriptStore({ prefix: 'vouch', home })
  app.log = store.log
  for (let index = 0; index < (args.seed ?? 0); index += 1) {
    await store.appendSaid({ threadId, text: `seeded ${index}` })
  }
  const handle = await startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: 'https://api.example.com',
    env: {},
    cwd: '/workspace',
    compose: async () => app,
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    fetchFn: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
  })
  running.push(handle)
  const client = await connect({ port: handle.port, token: TOKEN })
  client.send({ kind: EClientFrame.Hello, threadId, ...args.hello })
  const ready = await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
  return { client, store, ready, port: handle.port }
}

const vouchOf = (ready: ServeFrame): boolean | undefined =>
  ready.kind === EServeFrame.Ready ? ready.transcriptCurrent : undefined

describe('the transcript-currency vouch on ready', () => {
  it('vouches when the client is caught up to an empty log', async () => {
    const { ready } = await boot({ hello: { channelCursor: null, lastEventSeq: 0 } })

    expect(vouchOf(ready)).toBe(true)
  })

  it('vouches when the client is caught up to a seeded log', async () => {
    const { ready } = await boot({ hello: { channelCursor: null, lastEventSeq: 2 }, seed: 2 })

    expect(vouchOf(ready)).toBe(true)
  })

  it('declines to vouch when the client is behind the log', async () => {
    const { ready } = await boot({ hello: { channelCursor: null, lastEventSeq: 0 }, seed: 3 })

    expect(vouchOf(ready)).toBe(false)
  })

  it('sends the vouch on a resumed cursor too, not only on a reload greet', async () => {
    const first = await boot({ hello: { channelCursor: null, lastEventSeq: 1 }, seed: 1 })
    expect(vouchOf(first.ready)).toBe(true)
    const cursor = first.ready.kind === EServeFrame.Ready ? first.ready.seq : 0

    await first.store.appendSaid({ threadId, text: 'after the first attach' })
    const reattached = await connect({ port: first.port, token: TOKEN })
    reattached.send({ kind: EClientFrame.Hello, threadId, channelCursor: cursor, lastEventSeq: 1 })
    const second = await reattached.waitFor((frame) => frame.kind === EServeFrame.Ready)
    reattached.close()

    expect(vouchOf(second)).toBe(false)
  })
})
