import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toRunId, toThreadId, type EventDraft } from '@dltech/atlas-core'

import { EClientFrame, EServeFrame, ETurnStatus } from '@dltech/atlas-harness'

import { EWorkspaceState, startServe, type ServeHandle, type WorkspaceFiles } from '../index'

import { connect } from './client'
import { fakeServeApp } from './fakes'

const TOKEN = 'session-token'

const threadId = toThreadId('thread-intake')

const CONTROL_PLANE = 'https://api.example.com'

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

const inMemoryContextFiles = (): WorkspaceFiles => {
  const stored = new Map<string, string>()
  return {
    exists: async (path) => stored.has(path),
    read: async (path) => {
      const text = stored.get(path)
      if (text === undefined) throw new Error(`no such file: ${path}`)
      return text
    },
    write: async ({ path, text }) => {
      stored.set(path, text)
    },
    writeBytes: async ({ path, bytes }) => {
      stored.set(path, bytes.toString('utf8'))
    },
    ensureDirectory: async () => undefined,
    empty: async () => undefined,
  }
}

const startWithIntake = async (
  runTurn?: import('./fakes').RunTurn,
  holdStep?: (step: number) => Promise<void> | undefined,
): Promise<{
  handle: ServeHandle
  appended: readonly EventDraft[]
  app: ReturnType<typeof fakeServeApp>
}> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-intake-home-'))
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

  const app = fakeServeApp({ threadId, root: '/workspace', intake: true, runTurn, holdStep })
  const handle = await startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: CONTROL_PLANE,
    env: {},
    cwd: '/workspace',
    compose: async () => app,
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    contextFiles: inMemoryContextFiles(),
    fetchFn: (async (_input: unknown) => new Response(null, { status: 204 })) as typeof fetch,
  })
  running.push(handle)
  return { handle, appended: app.appended, app }
}

afterEach(async () => {
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
  while (running.length > 0) await running.pop()?.close()
  for (const home of homes.splice(0, homes.length)) {
    rmSync(home, { recursive: true, force: true })
  }
})

describe('a serve composed with the shared message intake', () => {
  it('starts a turn for a message queued while none was running', async () => {
    const { handle, appended } = await startWithIntake()

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Send, sendId: 'send-1' as never, text: 'first words' })
    await client.waitFor((frame) => frame.kind === EServeFrame.SendAcked)
    await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)

    const said = appended.filter((draft) => draft.type === 'user-said')
    expect(said).toHaveLength(1)
    expect(said[0]?.text).toBe('first words')
  })

  it('commits a mid-flight message after the running turn settles, before the next request', async () => {
    const held = gate()
    const entered = gate()
    const { handle, appended } = await startWithIntake(undefined, (step) => {
      if (step !== 2) return undefined
      entered.open()
      return held.opened
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Send, sendId: 'send-1' as never, text: 'first' })
    await client.waitFor((frame) => frame.kind === EServeFrame.SendAcked)
    await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)

    client.send({ kind: EClientFrame.Run })
    await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded && frame.outcome.status === 'idle')
    client.send({ kind: EClientFrame.Send, sendId: 'send-2' as never, text: 'second' })
    await entered.opened

    held.open()
    await client.waitFor(
      (frame) =>
        frame.kind === EServeFrame.TurnEnded &&
        appended.some((draft) => draft.type === 'user-said' && draft.text === 'second'),
    )

    const saidTexts = appended.flatMap((draft) => (draft.type === 'user-said' ? [draft.text] : []))
    expect(saidTexts).toEqual(['first', 'second'])
  })

  it('two sends landing in the same idle moment open one turn, not two', async () => {
    const held = gate()
    const entered = gate()
    const { handle, appended } = await startWithIntake(undefined, (step) => {
      if (step !== 1) return undefined
      entered.open()
      return held.opened
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Send, sendId: 'send-a' as never, text: 'one' })
    await entered.opened
    client.send({ kind: EClientFrame.Send, sendId: 'send-b' as never, text: 'two' })
    await client.waitFor((frame) => frame.kind === EServeFrame.SendAcked && frame.sendId === ('send-b' as never))

    held.open()
    await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)

    const saidTexts = appended.flatMap((draft) => (draft.type === 'user-said' ? [draft.text] : []))
    expect(saidTexts).toEqual(['one', 'two'])
  })
})
