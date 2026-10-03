import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import {
  EClientFrame, EClientRequest, EServeFrame, InProcessOperatorInput,
  LocalFileSystemPort, LocalProcessPort, OperatorInputTool, RandomIds, deliverOperatorInput,
} from '@dltech/atlas-harness'

import { EWorkspaceState, startServe } from '../index'
import { connect, type TestClient } from './client'
import { fakeServeApp } from './fakes'

const THREAD = toThreadId('operator-input-wire')
const TOKEN = 'synthetic-wire-session-token'
const TEXT = `  first\r\n${'word-世界\n'.repeat(3000)}  last  `

async function start() {
  const root = await mkdtemp(join(tmpdir(), 'atlas-operator-wire-'))
  const savedHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = root
  const app = fakeServeApp({ threadId: THREAD, root })
  const files = new LocalFileSystemPort()
  const processes = new LocalProcessPort()
  const registry = new InProcessOperatorInput({
    log: app.log, ids: new RandomIds(), channel: () => app.channel,
    deliver: (args) => deliverOperatorInput({ ...args, files, processes, timeoutMs: 100 }),
  })
  const tool = new OperatorInputTool({ operatorInput: registry, threads: app.threads })
  const handle = await startServe({
    threadId: THREAD, port: 0, token: TOKEN, cwd: root, env: {}, bufferSize: 1,
    controlPlaneUrl: 'https://api.example.test',
    compose: async () => ({ ...app, operatorInput: registry }),
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    fetchFn: Object.assign(async () => new Response(null, { status: 204 }), { preconnect: () => undefined }),
  })
  const clients: TestClient[] = []
  const attach = async () => {
    const client = await connect({ port: handle.port, token: TOKEN })
    clients.push(client)
    client.send({ kind: EClientFrame.Hello, threadId: THREAD, channelCursor: null, lastEventSeq: 0 })
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    return client
  }
  return {
    app, registry, tool, root, attach,
    close: async () => {
      for (const client of clients) client.close()
      await handle.close()
      if (savedHome === undefined) delete process.env.ATLAS_HOME
      else process.env.ATLAS_HOME = savedHome
      await rm(root, { recursive: true })
    },
  }
}

const submit = async (args: { client: TestClient; requestId: string; id: string; value: string }) => {
  args.client.send({
    kind: EClientFrame.Request, id: args.id, op: EClientRequest.ProvideOperatorInput,
    params: { requestId: args.requestId, value: args.value },
  })
  return await args.client.waitFor((frame) => frame.kind === EServeFrame.Reply && frame.replyTo === args.id)
}

const requested = async (client: TestClient) => {
  const frame = await client.waitFor((row) => row.kind === EServeFrame.Signal && row.signal.type === 'operator-input' && row.signal.request !== null)
  if (frame.kind !== EServeFrame.Signal || frame.signal.type !== 'operator-input' || frame.signal.request === null) {
    throw new Error('no operator request')
  }
  return frame.signal.request
}

describe('operator paste over the real serve WebSocket', () => {
  it('recovers an evicted pending card on reconnect and delivers the long text without a model round trip', async () => {
    const fixture = await start()
    try {
      const first = await fixture.attach()
      const path = join(fixture.root, 'received')
      const waiting = fixture.tool.invoke({
        input: { description: 'paste the login code', path, url: 'https://example.test/login' },
        signal: new AbortController().signal, idempotencyKey: 'wire-call', projectDirectory: fixture.root, threadId: THREAD,
      })
      const pending = await requested(first)
      first.close()
      await first.closed
      fixture.app.channel.publisherFor({ threadId: THREAD }).eventsAppended()
      fixture.app.channel.publisherFor({ threadId: THREAD }).eventsAppended()
      const reattached = await fixture.attach()
      expect(await requested(reattached)).toEqual(pending)
      const reply = await submit({ client: reattached, requestId: pending.requestId, id: 'paste-1', value: TEXT })
      expect(reply).toMatchObject({ ok: true, data: { delivered: true, bytes: Buffer.byteLength(TEXT) } })
      const toolResult = await waiting
      expect(toolResult.ok).toBe(true)
      expect(await readFile(path, 'utf8')).toBe(TEXT)
      expect(JSON.stringify(toolResult)).not.toContain('word-世界')
      expect(JSON.stringify(fixture.app.appended)).not.toContain('word-世界')
      const stale = await submit({ client: reattached, requestId: pending.requestId, id: 'paste-again', value: 'overwrite' })
      expect(stale).toMatchObject({ ok: false })
      expect(await readFile(path, 'utf8')).toBe(TEXT)
    } finally { await fixture.close() }
  })

  it('refuses unknown answers and clears the snapshot after cancellation', async () => {
    const fixture = await start()
    const controller = new AbortController()
    try {
      const client = await fixture.attach()
      const waiting = fixture.registry.request({
        threadId: THREAD, requestId: 'cancelled', description: 'paste a code',
        path: join(fixture.root, 'cancelled'), cwd: fixture.root, appendNewline: false, signal: controller.signal,
      })
      await requested(client)
      controller.abort()
      expect((await waiting).ok).toBe(false)
      const another = await fixture.attach()
      const empty = await another.waitFor((row) => row.kind === EServeFrame.Signal && row.signal.type === 'operator-input')
      expect(empty).toMatchObject({ signal: { type: 'operator-input', request: null } })
      expect(await submit({ client, requestId: 'cancelled', id: 'stale', value: TEXT })).toMatchObject({ ok: false })
      expect(await submit({ client, requestId: 'unknown', id: 'unknown', value: TEXT })).toMatchObject({ ok: false })
    } finally { await fixture.close() }
  })
})
