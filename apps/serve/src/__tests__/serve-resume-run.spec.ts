import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import {
  RESUME_NUDGE,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
} from '@dltech/atlas-core'

import { EClientFrame, EServeFrame } from '@dltech/atlas-harness'

import { EWorkspaceState, startServe, type ServeHandle, type WorkspaceFiles } from '../index'

import { connect, type TestClient } from './client'
import { fakeServeApp, type FakeServeApp } from './fakes'

const TOKEN = 'session-token'

const threadId = toThreadId('thread-resume-run')

const homes: string[] = []
let heldAtlasHome: string | undefined
const running: ServeHandle[] = []

const gate = () => {
  let open = (): void => undefined
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open: () => open() }
}

const noFiles = (): WorkspaceFiles => ({
  exists: async () => false,
  read: async () => {
    throw new Error('no such file')
  },
  write: async () => undefined,
  writeBytes: async () => undefined,
  ensureDirectory: async () => undefined,
  empty: async () => undefined,
})

const interruptedHistory: readonly Event[] = [
  {
    id: toEventId('ev-seed-1'),
    seq: 1,
    threadId,
    runId: toRunId('run-seed'),
    depth: 0,
    at: '2026-09-30T00:00:00.000Z',
    type: 'user-said',
    text: 'build the thing',
  },
  {
    id: toEventId('ev-seed-2'),
    seq: 2,
    threadId,
    runId: toRunId('run-seed'),
    depth: 0,
    at: '2026-09-30T00:00:01.000Z',
    type: 'assistant-said',
    parts: [{ type: 'text', text: 'I was partway through' }],
    interrupted: true,
  },
]

const start = async (args: {
  holdStep?: ((step: number) => Promise<void> | undefined) | undefined
}): Promise<{ handle: ServeHandle; app: FakeServeApp; client: TestClient }> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-resume-home-'))
  homes.push(home)
  heldAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  await mkdir(join(home, 'bootstrap'), { recursive: true })
  await writeFile(
    join(home, 'bootstrap', 'workspace-spec.json'),
    JSON.stringify({
      remoteUrl: null,
      branch: null,
      commit: null,
      patch: '',
      githubToken: null,
      contextBundle: null,
    }),
  )

  const app = fakeServeApp({
    threadId,
    root: '/workspace',
    intake: true,
    events: interruptedHistory,
    holdStep: args.holdStep,
  })
  const handle = await startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: 'https://api.example.com',
    env: {},
    cwd: '/workspace',
    compose: async () => app,
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    contextFiles: noFiles(),
    fetchFn: (async (_input: unknown) => new Response(null, { status: 204 })) as typeof fetch,
  })
  running.push(handle)

  const client = await connect({ port: handle.port, token: TOKEN })
  client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
  await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
  return { handle, app, client }
}

afterEach(async () => {
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
  while (running.length > 0) await running.pop()?.close()
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
})

const nudgesIn = (drafts: readonly EventDraft[]): number =>
  drafts.filter((draft) => draft.type === 'nudge' && draft.text === RESUME_NUDGE).length

const turnsEnded = (client: TestClient): number =>
  client.frames.filter((frame) => frame.kind === EServeFrame.TurnEnded).length

describe('a run frame carrying resume intent against a real serve socket', () => {
  it('appends the interrupted-turn nudge exactly once and runs the turn', async () => {
    const { app, client } = await start({})

    client.send({ kind: EClientFrame.Run, resume: true })
    await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)

    expect(nudgesIn(app.appended)).toBe(1)

    client.send({ kind: EClientFrame.Run, resume: true })
    await client.waitFor(() => turnsEnded(client) === 2)

    expect(nudgesIn(app.appended)).toBe(1)
  })

  it('adds no nudge when the run frame is bare', async () => {
    const { app, client } = await start({})

    client.send({ kind: EClientFrame.Run })
    await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)

    expect(nudgesIn(app.appended)).toBe(0)
  })

  it('refuses a second resume run while a turn is running, writing nothing and starting nothing', async () => {
    const held = gate()
    const { app, client } = await start({ holdStep: (step) => (step === 1 ? held.opened : undefined) })

    client.send({ kind: EClientFrame.Run, resume: true })
    await client.waitFor(
      (frame) => frame.kind === EServeFrame.Signal && frame.signal.type === 'turn-working',
    )
    await Bun.sleep(30)
    const writtenBefore = app.appended.length
    expect(nudgesIn(app.appended)).toBe(1)

    client.send({ kind: EClientFrame.Run, resume: true })
    const refusal = await client.waitFor((frame) => frame.kind === EServeFrame.Error)

    expect(JSON.stringify(refusal)).toContain('already running')
    expect(app.appended).toHaveLength(writtenBefore)

    held.open()
    await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)
    await Bun.sleep(30)

    expect(turnsEnded(client)).toBe(1)
    expect(nudgesIn(app.appended)).toBe(1)
    expect(app.appended.filter((draft) => draft.type === 'assistant-said')).toHaveLength(1)
  })

  it('refuses a bare run while a turn is running instead of re-arming another turn', async () => {
    const held = gate()
    const { app, client } = await start({ holdStep: (step) => (step === 1 ? held.opened : undefined) })

    client.send({ kind: EClientFrame.Run, resume: true })
    await client.waitFor(
      (frame) => frame.kind === EServeFrame.Signal && frame.signal.type === 'turn-working',
    )
    await Bun.sleep(30)
    const writtenBefore = app.appended.length

    client.send({ kind: EClientFrame.Run })
    const refusal = await client.waitFor((frame) => frame.kind === EServeFrame.Error)

    expect(JSON.stringify(refusal)).toContain('already running')
    expect(app.appended).toHaveLength(writtenBefore)

    held.open()
    await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)
    await Bun.sleep(30)

    expect(turnsEnded(client)).toBe(1)
    expect(app.appended.filter((draft) => draft.type === 'assistant-said')).toHaveLength(1)
  })
})
