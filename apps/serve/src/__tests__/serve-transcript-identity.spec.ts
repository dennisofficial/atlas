import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import {
  EClientFrame,
  EClientRequest,
  EServeFrame,
  transcriptIdentityDigest,
  transcriptIdentityReplySchema,
} from '@dltech/atlas-harness'

import { EWorkspaceState, startServe, type ServeHandle } from '../index'

import { connect, type TestClient } from './client'
import { fakeServeApp } from './fakes'
import { scratchTranscriptStore, type TranscriptStore } from './transcript-store-fixture'

const TOKEN = 'session-token'
const threadId = toThreadId('thread-identity')

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

const boot = async (): Promise<{ client: TestClient; store: TranscriptStore }> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-identity-'))
  homes.push(home)
  heldAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const app = fakeServeApp({ threadId, root: '/workspace' })
  const store = scratchTranscriptStore({ prefix: 'identity', home })
  app.log = store.log
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
  client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
  await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
  return { client, store }
}

const askIdentity = async (
  client: TestClient,
  id: string,
  params: unknown,
): Promise<{ ok: boolean; data: unknown }> => {
  client.send({ kind: EClientFrame.Request, id, op: EClientRequest.ReadTranscriptIdentity, params })
  const reply = await client.waitFor(
    (frame) => frame.kind === EServeFrame.Reply && frame.replyTo === id,
  )
  if (reply.kind !== EServeFrame.Reply) throw new Error('expected a reply')
  return { ok: reply.ok, data: reply.data }
}

describe('the read-transcript-identity op', () => {
  it('answers with the count and digest of the own log and carries no event bodies', async () => {
    const { client, store } = await boot()
    await store.appendSaid({ threadId, text: 'first thing said' })
    await store.appendSaid({ threadId, text: 'second thing said' })
    const events = await store.log.readOwn({ threadId })
    const reply = await askIdentity(client, 'id-1', { threadId })

    expect(reply.ok).toBe(true)
    const parsed = transcriptIdentityReplySchema.parse(reply.data)
    expect(parsed.count).toBe(events.length)
    expect(parsed.digest).toBe(transcriptIdentityDigest(events))
    expect(Object.keys(parsed)).toEqual(['count', 'digest'])
    expect(JSON.stringify(reply.data)).not.toContain('first thing said')
  })

  it('bounds the reply no matter how large the event bodies are', async () => {
    const { client, store } = await boot()
    const huge = 'x'.repeat(2 * 1024 * 1024)
    for (let index = 0; index < 4; index += 1) {
      await store.appendSaid({ threadId, text: `pasted-image-payload-${index}-${huge}` })
    }
    const events = await store.log.readOwn({ threadId })
    const reply = await askIdentity(client, 'id-big', { threadId })

    expect(reply.ok).toBe(true)
    const parsed = transcriptIdentityReplySchema.parse(reply.data)
    expect(parsed.count).toBe(events.length)
    expect(JSON.stringify(parsed).length).toBeLessThan(200)
    expect(JSON.stringify(parsed)).not.toContain('pasted-image-payload')
  })

  it('honors upTo when counting and digesting', async () => {
    const { client, store } = await boot()
    for (const text of ['one', 'two', 'three']) await store.appendSaid({ threadId, text })
    const all = await store.log.readOwn({ threadId })
    const reply = await askIdentity(client, 'id-upto', { threadId, upTo: 2 })

    expect(reply.ok).toBe(true)
    const parsed = transcriptIdentityReplySchema.parse(reply.data)
    expect(parsed.count).toBe(2)
    expect(parsed.digest).toBe(transcriptIdentityDigest(all.slice(0, 2)))

    const whole = await askIdentity(client, 'id-whole', { threadId })
    expect(transcriptIdentityReplySchema.parse(whole.data).count).toBe(3)
  })

  it('accepts upTo 0 as an empty own log, excluding a boot event at seq 1', async () => {
    const { client, store } = await boot()
    await store.appendSaid({ threadId, text: 'capability event' })
    const reply = await askIdentity(client, 'id-zero', { threadId, upTo: 0 })

    expect(reply.ok).toBe(true)
    const parsed = transcriptIdentityReplySchema.parse(reply.data)
    expect(parsed).toEqual({ count: 0, digest: transcriptIdentityDigest([]) })
  })

  it('refuses malformed params', async () => {
    const { client } = await boot()

    const missing = await askIdentity(client, 'id-bad-1', {})
    expect(missing.ok).toBe(false)

    const negative = await askIdentity(client, 'id-bad-2', { threadId, upTo: -1 })
    expect(negative.ok).toBe(false)
  })
})
