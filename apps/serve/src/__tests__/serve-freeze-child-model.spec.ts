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
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-freeze-'))
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
      threads: {
        ...app.threads,
        find: async ({ threadId: requested }) => {
          const root = await app.threads.find({ threadId })
          if (requested === threadId) return root
          if (requested !== toThreadId('thread-child') || root === undefined) return undefined
          return { ...root, id: requested, agent: { spawnedBy: threadId, type: 'explore' } }
        },
      },
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

describe('a transcript write targeting a child or foreign thread', () => {
  it('still permits renaming a child thread without changing its model', async () => {
    const { app, client } = await start()

    client.send({
      kind: EClientFrame.Request,
      id: 'ren-foreign',
      op: EClientRequest.RenameThread,
      params: { threadId: toThreadId('thread-child'), title: 'not yours' },
    })

    const reply = await client.waitFor(
      (frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'ren-foreign',
    )
    expect(reply).toMatchObject({ ok: true })
    expect(app.renames).toEqual([{ threadId: toThreadId('thread-child'), title: 'not yours' }])
  })

  it('refuses a model pick that targets a child thread, neither recording it nor re-pinning the loop', async () => {
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
      id: 'mod-child',
      op: EClientRequest.SetThreadModel,
      params: { threadId: toThreadId('thread-child'), model: { ref: 'openai/gpt-5-codex', effort: 'low' } },
    })

    const reply = await client.waitFor(
      (frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'mod-child',
    )
    expect(reply).toMatchObject({ ok: false })
    expect(app.chosenModels).toEqual([])
    expect(selected).toEqual([])
  })
})

describe('a set-thread-model op against a supervised agent', () => {
  it('refuses to re-model a supervised served thread even with an operator override', async () => {
    const { answerSetThreadModel } = await import('../requests')
    const chosen: { threadId: string; model: { ref: string; effort: string } }[] = []
    const selected: { ref: string; effort: string }[] = []

    const reply = await answerSetThreadModel({
      frame: {
        kind: EClientFrame.Request,
        id: 'mod-agent',
        op: EClientRequest.SetThreadModel,
        params: { threadId, model: { ref: 'anthropic/claude-opus-5', effort: 'high' }, retarget: true },
      },
      threadId,
      transcript: {
        log: { read: async () => [], readOwn: async () => [] },
        threads: {
          find: async () => ({
            id: threadId,
            head: 0,
            createdAt: '2026-09-16T00:00:00.000Z',
            updatedAt: '2026-09-16T00:00:00.000Z',
            workspace: '/workspace',
            repo: null,
            agent: { spawnedBy: toThreadId('thread-parent'), type: 'task' },
          }),
          spawned: async () => [],
          rename: async () => {},
          chooseModel: async (given) => {
            chosen.push(given)
          },
        },
        ledger: { forThreadTree: async () => ({ own: [], delegated: [] }) },
      },
      select: (next) => selected.push(next),
    })

    expect(reply.ok).toBe(false)
    expect(JSON.stringify(reply.data)).toContain('spawned with')
    expect(chosen).toEqual([])
    expect(selected).toEqual([])
  })
})
