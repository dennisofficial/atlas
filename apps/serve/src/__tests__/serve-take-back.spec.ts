import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import { EClientFrame, EClientRequest, EServeFrame, type ServeFrame } from '@dltech/atlas-harness'
import { EWorkspaceState, startServe, type ServeHandle } from '../index'

import { connect, type TestClient } from './client'
import { fakeServeApp, type FakeServeApp } from './fakes'

const TOKEN = 'session-token'
const threadId = toThreadId('thread-take-back')
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

const gate = () => {
  let open = (): void => undefined
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open: () => open() }
}

const attach = async (handle: ServeHandle): Promise<TestClient> => {
  const client = await connect({ port: handle.port, token: TOKEN })
  client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
  await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
  return client
}

const start = async (
  args: { holdStep?: (step: number) => Promise<void> | undefined; withoutPending?: boolean; intake?: boolean } = {},
): Promise<{ handle: ServeHandle; app: FakeServeApp; client: TestClient }> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-take-back-'))
  homes.push(home)
  heldAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const app = fakeServeApp({ threadId, root: '/workspace', intake: args.intake === true, holdStep: args.holdStep })
  const handle = await startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: CONTROL_PLANE,
    env: {},
    cwd: '/workspace',
    compose: async () => (args.withoutPending === true ? { ...app, pending: undefined } : app),
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    fetchFn: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
  })
  running.push(handle)
  return { handle, app, client: await attach(handle) }
}

const pendingChanged = (frame: ServeFrame, entries?: number | readonly string[]): boolean => {
  if (frame.kind !== EServeFrame.Signal || frame.signal.type !== 'pending-changed') return false
  if (entries === undefined) return true
  if (typeof entries === 'number') return frame.signal.entries.length === entries
  return JSON.stringify(frame.signal.entries.map((entry) => entry.text)) === JSON.stringify(entries)
}

const takeBack = async (args: { client: TestClient; id: string; params?: unknown }): Promise<ServeFrame> => {
  args.client.send({
    kind: EClientFrame.Request,
    id: args.id,
    op: EClientRequest.TakeBackPending,
    params: args.params === undefined ? { threadId } : args.params,
  })
  return await args.client.waitFor((frame) => frame.kind === EServeFrame.Reply && frame.replyTo === args.id)
}

describe('the take-back-pending op', () => {
  it('hands back a queued operator message and broadcasts the emptied queue', async () => {
    const { app, client } = await start()
    app.pending?.forThread({ threadId }).enqueue({ text: 'actually, never mind' })
    await client.waitFor((frame) => pendingChanged(frame, 1))

    const reply = await takeBack({ client, id: 'tb-1' })

    expect(reply).toMatchObject({ ok: true, data: { taken: { text: 'actually, never mind', images: [], files: [] } } })
    expect(app.pending?.forThread({ threadId }).getSnapshot()).toHaveLength(0)
    await client.waitFor((frame) => pendingChanged(frame, 0))
  })

  it('answers null when nothing is queued', async () => {
    const { client } = await start()

    const reply = await takeBack({ client, id: 'tb-2' })

    expect(reply).toMatchObject({ ok: true, data: { taken: null } })
  })

  it('refuses malformed params', async () => {
    const { client } = await start()

    const reply = await takeBack({ client, id: 'tb-3', params: {} })

    expect(reply).toMatchObject({ ok: false })
  })

  it('never takes back an entry the running turn has reserved', async () => {
    const { app, client } = await start()
    const queue = app.pending?.forThread({ threadId })
    queue?.enqueue({ text: 'already in flight' })
    queue?.prepare()
    queue?.enqueue({ text: 'still editable' })

    const first = await takeBack({ client, id: 'tb-4' })
    const second = await takeBack({ client, id: 'tb-5' })

    expect(first).toMatchObject({ ok: true, data: { taken: { text: 'still editable' } } })
    expect(second).toMatchObject({ ok: true, data: { taken: null } })
    expect(queue?.getSnapshot().map((entry) => entry.text)).toEqual(['already in flight'])
  })

  it('refuses the op when the serve has no pending queue', async () => {
    const { client } = await start({ withoutPending: true })

    const reply = await takeBack({ client, id: 'tb-6' })

    expect(reply).toMatchObject({ ok: false })
    expect(JSON.stringify(reply)).toContain('no pending queue')
  })
})

describe('pending-changed broadcasts', () => {
  it('announces a send that lands mid-turn, and a fresh client reads the queue after Ready', async () => {
    const entered = gate()
    const held = gate()
    const { handle, client } = await start({
      intake: true,
      holdStep: (step) => {
        if (step !== 1) return undefined
        entered.open()
        return held.opened
      },
    })

    client.send({ kind: EClientFrame.Send, sendId: 'send-1' as never, text: 'first' })
    await entered.opened
    client.send({ kind: EClientFrame.Send, sendId: 'send-2' as never, text: 'queued behind the turn' })

    const announced = await client.waitFor((frame) => pendingChanged(frame, ['queued behind the turn']))
    expect(announced).toMatchObject({
      signal: { entries: [{ text: 'queued behind the turn', reserved: false }] },
    })

    const late = await attach(handle)
    const snapshot = await late.waitFor((frame) => pendingChanged(frame, ['queued behind the turn']))
    const ready = late.frames.findIndex((frame) => frame.kind === EServeFrame.Ready)
    expect(late.frames.indexOf(snapshot)).toBeGreaterThan(ready)
    held.open()
  })

  it('shows a reserved entry as reserved to a client that attaches afterwards', async () => {
    const { handle, app } = await start()
    const queue = app.pending?.forThread({ threadId })
    queue?.enqueue({ text: 'handed to the loop' })
    queue?.prepare()

    const late = await attach(handle)
    const snapshot = await late.waitFor((frame) => pendingChanged(frame, 1))

    expect(snapshot).toMatchObject({ signal: { entries: [{ text: 'handed to the loop', reserved: true }] } })
  })
})
