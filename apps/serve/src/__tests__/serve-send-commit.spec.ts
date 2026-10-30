import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { EContextSlot, toThreadId } from '@dltech/atlas-core'

import { EClientFrame, EServeFrame, type ServeFrame } from '@dltech/atlas-harness'
import { EWorkspaceState, startServe, type ServeHandle } from '../index'

import { connect, type TestClient } from './client'
import { fakeServeApp, type FakeServeApp } from './fakes'

const TOKEN = 'session-token'
const threadId = toThreadId('thread-send-commit')
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

const eventsAppended = (frame: ServeFrame): boolean =>
  frame.kind === EServeFrame.Signal && frame.signal.type === 'events-appended'

const start = async (
  args: {
    holdStep?: (step: number) => Promise<void> | undefined
    expandContext?: FakeServeApp['expandContext']
  } = {},
): Promise<{ app: FakeServeApp; client: TestClient }> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-send-commit-'))
  homes.push(home)
  heldAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const app = fakeServeApp({
    threadId,
    root: '/workspace',
    holdStep: args.holdStep,
    expandContext: args.expandContext,
  })
  const handle = await startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: CONTROL_PLANE,
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
  return { app, client }
}

describe('a Send commit', () => {
  it('publishes events-appended the moment the first message commits, before the turn ends', async () => {
    const held = gate()
    const { client } = await start({ holdStep: (step) => (step === 1 ? held.opened : undefined) })

    client.send({ kind: EClientFrame.Send, sendId: 'send-1' as never, text: 'first words' })

    await client.waitFor(eventsAppended)
    expect(client.frames.some((frame) => frame.kind === EServeFrame.TurnEnded)).toBe(false)

    held.open()
    await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)
  })

  it('publishes events-appended for a steady-state send on an existing thread', async () => {
    const { client } = await start()

    client.send({ kind: EClientFrame.Send, sendId: 'send-1' as never, text: 'first words' })
    await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)

    const beforeSecond = client.frames.length
    client.send({ kind: EClientFrame.Send, sendId: 'send-2' as never, text: 'again' })

    const appended = await client.waitFor(
      (frame) => eventsAppended(frame) && client.frames.indexOf(frame) >= beforeSecond,
    )
    expect(appended).toMatchObject({ signal: { type: 'events-appended' } })
  })

  it('expands skills explicitly when the session has no intake', async () => {
    const { app, client } = await start({
      expandContext: ({ text }) => [
        { type: 'context-loaded', slot: EContextSlot.Skill, key: 'review', content: text },
      ],
    })

    client.send({ kind: EClientFrame.Send, sendId: 'send-1' as never, text: '/review' })
    await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)

    expect(app.appended.map((draft) => draft.type)).toEqual(['context-loaded', 'user-said'])
  })
})
