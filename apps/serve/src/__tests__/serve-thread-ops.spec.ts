import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import { EClientFrame, EClientRequest, EServeFrame } from '@dltech/atlas-harness'
import { EWorkspaceState, startServe, type ServeHandle } from '../index'

import { connect, type TestClient } from './client'
import { fakeServeApp, type FakeServeApp } from './fakes'

const TOKEN = 'session-token'
const threadId = toThreadId('thread-serve')
const CONTROL_PLANE = 'https://api.example.com'

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

const start = async (args: {
  modelBridge?: { catalogue: never; effort: () => string; select: (next: { ref: string; effort: string }) => void } | undefined
} = {}): Promise<{ handle: ServeHandle; app: FakeServeApp; client: TestClient }> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-ops-'))
  homes.push(home)
  heldAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const app = fakeServeApp({ threadId, root: '/workspace' })
  const handle = await startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: CONTROL_PLANE,
    env: {},
    cwd: '/workspace',
    compose: async () => ({
      ...app,
      ...(args.modelBridge === undefined ? {} : { modelBridge: args.modelBridge }),
    }),
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    fetchFn: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
  })
  running.push(handle)

  const client = await connect({ port: handle.port, token: TOKEN })
  client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
  await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
  return { handle, app, client }
}

describe('the rename-thread op', () => {
  it('renames the served thread and broadcasts the new title to every attached client', async () => {
    const { app, client } = await start()

    client.send({
      kind: EClientFrame.Request,
      id: 'ren-1',
      op: EClientRequest.RenameThread,
      params: { threadId, title: 'wire the model pick' },
    })

    const reply = await client.waitFor(
      (frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'ren-1',
    )
    expect(reply).toMatchObject({ ok: true, data: { threadId, title: 'wire the model pick' } })
    expect(app.renames).toEqual([{ threadId, title: 'wire the model pick' }])

    const pushed = await client.waitFor((frame) => frame.kind === EServeFrame.ThreadRenamed)
    expect(pushed).toEqual({ kind: EServeFrame.ThreadRenamed, threadId, title: 'wire the model pick' })
  })

  it('refuses a rename with malformed params', async () => {
    const { app, client } = await start()

    client.send({
      kind: EClientFrame.Request,
      id: 'ren-2',
      op: EClientRequest.RenameThread,
      params: { threadId },
    })

    const reply = await client.waitFor(
      (frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'ren-2',
    )
    expect(reply).toMatchObject({ ok: false })
    expect(app.renames).toEqual([])
  })
})

describe('the set-thread-model op', () => {
  it('records the pick, re-pins the running loop, and broadcasts it', async () => {
    const selected: { ref: string; effort: string }[] = []
    const { app, client } = await start({
      modelBridge: {
        catalogue: undefined as never,
        effort: () => 'medium',
        select: (next) => selected.push(next),
      },
    })

    client.send({
      kind: EClientFrame.Request,
      id: 'mod-1',
      op: EClientRequest.SetThreadModel,
      params: { threadId, model: { ref: 'anthropic/claude-opus-5', effort: 'high' } },
    })

    const reply = await client.waitFor(
      (frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'mod-1',
    )
    expect(reply).toMatchObject({
      ok: true,
      data: { threadId, model: { ref: 'anthropic/claude-opus-5', effort: 'high' } },
    })
    expect(app.chosenModels).toEqual([
      { threadId, model: { ref: 'anthropic/claude-opus-5', effort: 'high' } },
    ])
    expect(selected).toEqual([{ ref: 'anthropic/claude-opus-5', effort: 'high' }])

    const pushed = await client.waitFor((frame) => frame.kind === EServeFrame.ThreadModelChanged)
    expect(pushed).toEqual({
      kind: EServeFrame.ThreadModelChanged,
      threadId,
      model: { ref: 'anthropic/claude-opus-5', effort: 'high' },
    })
  })

  it('still records and broadcasts when the serve has no live model to re-pin', async () => {
    const { app, client } = await start()

    client.send({
      kind: EClientFrame.Request,
      id: 'mod-2',
      op: EClientRequest.SetThreadModel,
      params: { threadId, model: { ref: 'openai/gpt-5-codex', effort: 'low' } },
    })

    const reply = await client.waitFor(
      (frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'mod-2',
    )
    expect(reply).toMatchObject({ ok: true })
    expect(app.chosenModels).toEqual([
      { threadId, model: { ref: 'openai/gpt-5-codex', effort: 'low' } },
    ])
  })

  it('refuses a model pick with malformed params', async () => {
    const { app, client } = await start()

    client.send({
      kind: EClientFrame.Request,
      id: 'mod-3',
      op: EClientRequest.SetThreadModel,
      params: { threadId, model: { ref: 'anthropic/claude-opus-5' } },
    })

    const reply = await client.waitFor(
      (frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'mod-3',
    )
    expect(reply).toMatchObject({ ok: false })
    expect(app.chosenModels).toEqual([])
  })

})

describe('store-originated transcript changes', () => {
  it('broadcasts a rename the sandbox wrote itself — the auto-titler the composer never saw', async () => {
    const { app, client } = await start()

    app.fireRename({ threadId, title: 'a title the titler wrote' })

    const pushed = await client.waitFor((frame) => frame.kind === EServeFrame.ThreadRenamed)
    expect(pushed).toEqual({
      kind: EServeFrame.ThreadRenamed,
      threadId,
      title: 'a title the titler wrote',
    })
  })

  it('broadcasts a model change the sandbox wrote itself', async () => {
    const { app, client } = await start()

    app.fireModelChosen({ threadId, model: { ref: 'anthropic/claude-sonnet-4-5', effort: 'max' } })

    const pushed = await client.waitFor((frame) => frame.kind === EServeFrame.ThreadModelChanged)
    expect(pushed).toEqual({
      kind: EServeFrame.ThreadModelChanged,
      threadId,
      model: { ref: 'anthropic/claude-sonnet-4-5', effort: 'max' },
    })
  })
})

describe('answerRequest', () => {
  it('answers an op it has no handler for with a protocol refusal, never a publish-workspace reply', async () => {
    const { answerRequest } = await import('../requests')
    let publishes = 0

    const reply = await answerRequest({
      frame: {
        kind: EClientFrame.Request,
        id: 'wat-1',
        op: 'an-op-from-a-newer-client' as EClientRequest,
        params: {},
      },
      files: { list: async () => [] },
      publish: async () => {
        publishes += 1
        return null
      },
    })

    expect(reply.ok).toBe(false)
    expect(JSON.stringify(reply.data)).toContain('unknown request op')
    expect(publishes).toBe(0)
  })

  it('routes publish-workspace to the publisher, and only publish-workspace', async () => {
    const { answerRequest } = await import('../requests')
    let publishes = 0

    const reply = await answerRequest({
      frame: {
        kind: EClientFrame.Request,
        id: 'pub-1',
        op: EClientRequest.PublishWorkspace,
        params: {},
      },
      files: { list: async () => [] },
      publish: async () => {
        publishes += 1
        return null
      },
    })

    expect(reply.ok).toBe(true)
    expect(publishes).toBe(1)
  })
})
