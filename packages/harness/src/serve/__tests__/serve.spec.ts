import { afterEach, describe, expect, it } from 'bun:test'

import {
  EPortExposure,
  toRunId,
  toThreadId,
  type EnvironmentCapabilities,
  type ThreadId,
} from '@dltech/atlas-core'

import { EStepEnd } from '../../channel/signal'
import {
  CHANNEL_PROTOCOL_VERSION,
  EClientFrame,
  EClientRequest,
  EServeFrame,
  type ServeFrame,
} from '../../cloud/channel-wire'
import { ETurnStatus, type TurnOutcome } from '../../loop/turn-outcome'
import {
  EServeEnv,
  EServeEvent,
  EWorkspaceState,
  EWorkspaceStep,
  startServe,
  type EnsureWorkspace,
  type ServeHandle,
  type WorkspaceFiles,
  type WorkspacePublisher,
  type WorkspaceReadiness,
} from '../index'

import { connect } from './client'
import { fakeServeApp, fakeWakeNotices, type FakeServeApp, type RunTurn } from './fakes'

const TOKEN = 'session-token'

const threadId = toThreadId('thread-serve')

const CONTROL_PLANE = 'https://api.example.com'

type Started = { handle: ServeHandle; app: FakeServeApp; lines: string[] }

const running: ServeHandle[] = []

/**
 * `startServe` defaults its context materialization to the real filesystem, so a spec that never
 * injects one would otherwise stamp the developer's own Atlas home the moment a fetchFn override
 * lets the workspace spec resolve.
 */
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
    empty: async () => undefined,
  }
}

const start = async (args: {
  runTurn?: RunTurn | undefined
  entries?: Record<string, readonly { name: string; isDirectory: boolean }[]> | undefined
  bufferSize?: number | undefined
  env?: Record<string, string | undefined> | undefined
  workspace?: WorkspaceReadiness | undefined
  ensureWorkspace?: EnsureWorkspace | undefined
  publishWorkspace?: WorkspacePublisher | undefined
  adoptChildren?: ((args: { threadId: ThreadId }) => Promise<readonly ThreadId[]>) | undefined
  whenChildrenSettled?: (() => Promise<void>) | undefined
  wakeNotices?: boolean | undefined
  idleMinutes?: number | undefined
  idleTickMs?: number | undefined
  exit?: ((code: number) => void) | undefined
  fetchFn?: typeof fetch | undefined
  contextFiles?: WorkspaceFiles | undefined
}): Promise<Started> => {
  const lines: string[] = []
  const app = fakeServeApp({
    threadId,
    root: '/workspace',
    runTurn: args.runTurn,
    entries: args.entries,
    adoptChildren: args.adoptChildren,
    whenChildrenSettled: args.whenChildrenSettled,
    wakeNotices: args.wakeNotices,
  })

  const told =
    args.env === undefined
      ? { threadId, port: 0, token: TOKEN, controlPlaneUrl: CONTROL_PLANE, env: {} }
      : { env: args.env }

  const handle = await startServe({
    ...told,
    cwd: '/workspace',
    bufferSize: args.bufferSize,
    write: (line) => lines.push(line),
    fetchFn:
      args.fetchFn ??
      ((async (_input: unknown) => new Response(null, { status: 204 })) as typeof fetch),
    compose: async () => app,
    ensureWorkspace:
      args.ensureWorkspace ?? (async () => args.workspace ?? { state: EWorkspaceState.Skipped }),
    publishWorkspace: args.publishWorkspace,
    idleMinutes: args.idleMinutes,
    idleTickMs: args.idleTickMs,
    exit: args.exit,
    contextFiles: args.contextFiles ?? inMemoryContextFiles(),
  })

  running.push(handle)
  return { handle, app, lines }
}

const hello = (args: { channelCursor: number | null; lastEventSeq: number; protocol?: number }) =>
  ({ kind: EClientFrame.Hello, threadId, ...args }) as const

const seqsOf = (frames: readonly ServeFrame[]): number[] =>
  frames.flatMap((frame) => (frame.kind === EServeFrame.Signal ? [frame.seq] : []))

const stepIdsOf = (frames: readonly ServeFrame[]): string[] =>
  frames.flatMap((frame) => {
    if (frame.kind !== EServeFrame.Signal) return []
    const { signal } = frame
    if (signal.type === 'step-started' || signal.type === 'chunk') return [signal.stepId]
    if (signal.type === 'step-ended') return [signal.stepId]
    return []
  })

const isStep = (frame: ServeFrame, type: 'chunk' | 'step-ended'): boolean =>
  frame.kind === EServeFrame.Signal && frame.signal.type === type

const wakeNoticesOf = (app: FakeServeApp): ReturnType<typeof fakeWakeNotices> => {
  if (app.wakeNotices === undefined) throw new Error('the spec did not ask for wakeNotices')
  return app.wakeNotices as ReturnType<typeof fakeWakeNotices>
}

const textChunk = (text: string) => ({ type: 'text-delta', id: 'block', text }) as const

const gate = () => {
  let open = (): void => undefined
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open: () => open() }
}

afterEach(async () => {
  while (running.length > 0) await running.pop()?.close()
})

describe('startServe', () => {
  it('refuses a websocket upgrade carrying the wrong token', async () => {
    const { handle } = await start({})

    await expect(connect({ port: handle.port, token: 'not-the-token' })).rejects.toThrow()
  })

  it('answers health only for the session token', async () => {
    const { handle } = await start({})
    const url = `http://127.0.0.1:${handle.port}/v1/health`

    expect((await fetch(url)).status).toBe(401)

    const allowed = await fetch(url, { headers: { authorization: `Bearer ${TOKEN}` } })
    expect(allowed.status).toBe(200)
    expect(await allowed.json()).toMatchObject({ ok: true, threadId, turnRunning: false })
  })

  it('parks attached clients: broadcasts the reason, then closes them cleanly at 1001', async () => {
    const { handle, lines } = await start({})
    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    const response = await fetch(`http://127.0.0.1:${handle.port}/v1/park`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'the sandbox parked after sitting idle' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    const parked = await client.waitFor((frame) => frame.kind === EServeFrame.Parked)
    expect(parked).toEqual({
      kind: EServeFrame.Parked,
      reason: 'the sandbox parked after sitting idle',
    })
    expect(await client.closed).toBe(1001)
    expect(lines.some((line) => line.includes('serve.clients-parked'))).toBe(true)
  })

  it('refuses a park request without the session token', async () => {
    const { handle } = await start({})

    const response = await fetch(`http://127.0.0.1:${handle.port}/v1/park`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'the sandbox was stopped' }),
    })

    expect(response.status).toBe(401)
  })

  it('rejects a park request missing a reason and never touches attached clients', async () => {
    const { handle } = await start({})
    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    const response = await fetch(`http://127.0.0.1:${handle.port}/v1/park`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(400)
    await Bun.sleep(10)
    expect(client.frames.some((frame) => frame.kind === EServeFrame.Parked)).toBe(false)
  })

  it('never sends a parked frame to a socket that has not said hello', async () => {
    const { handle } = await start({})
    const client = await connect({ port: handle.port, token: TOKEN })

    const response = await fetch(`http://127.0.0.1:${handle.port}/v1/park`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'the sandbox was stopped' }),
    })

    expect(response.status).toBe(200)
    await Bun.sleep(10)
    expect(client.frames).toEqual([])
    client.close()
  })

  it('closes a socket whose first frame is not hello', async () => {
    const { handle } = await start({})
    const client = await connect({ port: handle.port, token: TOKEN })

    client.send({ kind: EClientFrame.Send, text: 'hi' })

    expect(await client.closed).toBe(1008)
    expect(client.frames.at(-1)).toEqual({
      kind: EServeFrame.Error,
      message: 'the first frame must be hello',
    })
  })

  it('refuses a hello on a newer wire protocol, saying how to rebuild the serve', async () => {
    const { handle } = await start({})
    const client = await connect({ port: handle.port, token: TOKEN })

    client.send(hello({ channelCursor: null, lastEventSeq: 0, protocol: CHANNEL_PROTOCOL_VERSION + 1 }))

    expect(await client.closed).toBe(1008)
    const last = client.frames.at(-1)
    expect(last?.kind).toBe(EServeFrame.Error)
    if (last?.kind !== EServeFrame.Error) throw new Error('expected an error frame')
    expect(last.message).toContain('re-open the conversation')
  })

  it('refuses a hello on an older wire protocol, saying to update Atlas', async () => {
    const { handle } = await start({})
    const client = await connect({ port: handle.port, token: TOKEN })

    client.send(hello({ channelCursor: null, lastEventSeq: 0, protocol: CHANNEL_PROTOCOL_VERSION - 1 }))

    expect(await client.closed).toBe(1008)
    const last = client.frames.at(-1)
    expect(last?.kind).toBe(EServeFrame.Error)
    if (last?.kind !== EServeFrame.Error) throw new Error('expected an error frame')
    expect(last.message).toContain('update Atlas')
  })

  it('greets a hello too old to carry a protocol stamp', async () => {
    const { handle } = await start({})
    const client = await connect({ port: handle.port, token: TOKEN })

    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))

    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
  })

  it('replays only the frames after a cursor it still holds', async () => {
    const { handle, app } = await start({})
    const publisher = app.channel.publisherFor({ threadId })
    publisher.onChunk(textChunk('one'))
    publisher.onChunk(textChunk('two'))

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: 0, lastEventSeq: 4 }))

    await client.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.seq === 2)
    expect(client.frames[0]).toEqual({
      kind: EServeFrame.Ready,
      seq: 3,
      protocol: CHANNEL_PROTOCOL_VERSION,
      turnInFlight: false,
    })
    expect(seqsOf(client.frames)).toEqual([1, 2])
  })

  it('tells a client with no cursor to re-read the log, then hands it the step in flight', async () => {
    const { handle, app } = await start({})
    const publisher = app.channel.publisherFor({ threadId })
    publisher.onChunk(textChunk('one'))
    publisher.onChunk(textChunk('two'))

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 9 }))

    await client.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.seq === 2)
    expect(client.frames[0]).toEqual({ kind: EServeFrame.Reload, sinceEventSeq: 9 })
    expect(client.frames[1]).toEqual({
      kind: EServeFrame.Ready,
      seq: 3,
      protocol: CHANNEL_PROTOCOL_VERSION,
      turnInFlight: false,
    })
    expect(seqsOf(client.frames)).toEqual([0, 1, 2])
  })

  it('tells a client whose cursor fell out of the ring to re-read the log', async () => {
    const { handle, app } = await start({ bufferSize: 2 })
    const publisher = app.channel.publisherFor({ threadId })
    for (const text of ['one', 'two', 'three']) publisher.onChunk(textChunk(text))

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: 0, lastEventSeq: 2 }))

    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    expect(client.frames[0]).toEqual({ kind: EServeFrame.Reload, sinceEventSeq: 2 })
  })

  it('replays the step in flight under a fresh id, and keeps that client on it', async () => {
    const { handle, app } = await start({})
    const publisher = app.channel.publisherFor({ threadId })
    publisher.onChunk(textChunk('one'))

    const live = await connect({ port: handle.port, token: TOKEN })
    live.send(hello({ channelCursor: 0, lastEventSeq: 0 }))
    await live.waitFor((frame) => frame.kind === EServeFrame.Ready)

    const reloaded = await connect({ port: handle.port, token: TOKEN })
    reloaded.send(hello({ channelCursor: null, lastEventSeq: 9 }))
    await reloaded.waitFor((frame) => isStep(frame, 'chunk'))

    const replayed = stepIdsOf(reloaded.frames)[0]
    expect(replayed).toBeDefined()
    expect(replayed).not.toBe(`${threadId}#1`)

    publisher.onChunk(textChunk('two'))
    publisher.close({ end: EStepEnd.Completed })
    await reloaded.waitFor((frame) => isStep(frame, 'step-ended'))
    await live.waitFor((frame) => isStep(frame, 'step-ended'))

    expect(new Set(stepIdsOf(reloaded.frames))).toEqual(new Set([replayed as string]))
    expect(new Set(stepIdsOf(live.frames))).toEqual(new Set([`${threadId}#1`]))
  })

  it('leaves a resumed client on the step id it already knows', async () => {
    const { handle, app } = await start({})
    const publisher = app.channel.publisherFor({ threadId })
    publisher.onChunk(textChunk('one'))
    publisher.onChunk(textChunk('two'))

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: 0, lastEventSeq: 4 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.seq === 2)

    expect(stepIdsOf(client.frames)).toEqual([`${threadId}#1`, `${threadId}#1`])
  })

  it('never backfills a step whose start has aged out of the ring', async () => {
    const { handle, app } = await start({ bufferSize: 2 })
    const publisher = app.channel.publisherFor({ threadId })
    for (const text of ['one', 'two', 'three']) publisher.onChunk(textChunk(text))

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 3 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    await Bun.sleep(10)

    expect(client.frames.map((frame) => frame.kind)).toEqual([
      EServeFrame.Reload,
      EServeFrame.Ready,
    ])

    publisher.onChunk(textChunk('four'))
    await client.waitFor((frame) => isStep(frame, 'chunk'))

    expect(stepIdsOf(client.frames)[0]).not.toBe(`${threadId}#1`)
  })

  it('forwards live signals in order under a monotonic seq', async () => {
    const { handle, app } = await start({})
    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    const publisher = app.channel.publisherFor({ threadId })
    for (const text of ['one', 'two', 'three']) publisher.onChunk(textChunk(text))

    await client.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.seq === 3)
    expect(seqsOf(client.frames)).toEqual([0, 1, 2, 3])
  })

  it('answers a request while a turn is streaming', async () => {
    const held = gate()
    const { handle, app } = await start({
      entries: {
        'src/': [
          { name: 'channel', isDirectory: true },
          { name: 'chunk.ts', isDirectory: false },
          { name: 'other.ts', isDirectory: false },
        ],
      },
      runTurn: async () => {
        const publisher = app.channel.publisherFor({ threadId })
        publisher.onChunk(textChunk('one'))
        await held.opened
        publisher.onChunk(textChunk('two'))
        return { status: ETurnStatus.Completed, runId: toRunId('run-1') }
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Send, text: 'go' })
    await client.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.seq === 1)

    client.send({
      kind: EClientFrame.Request,
      id: 'ask-1',
      op: EClientRequest.CompletePaths,
      params: { query: 'src/ch' },
    })
    const reply = await client.waitFor((frame) => frame.kind === EServeFrame.Reply)

    expect(reply).toEqual({
      kind: EServeFrame.Reply,
      replyTo: 'ask-1',
      ok: true,
      data: {
        directory: 'src/',
        fragment: 'ch',
        entries: [
          { name: 'channel', isDirectory: true },
          { name: 'chunk.ts', isDirectory: false },
        ],
      },
    })

    held.open()
    await client.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.seq === 2)
    expect(app.appended).toEqual([{ type: 'user-said', text: 'go' }])
  })

  it('commits a send with images and context exactly as a local turn would', async () => {
    const { handle, app } = await start({})

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({
      kind: EClientFrame.Send,
      text: 'go',
      images: [{ path: '/tmp/shot.png', mediaType: 'image/png', data: 'aGVsbG8=', width: 2, height: 1 }],
      context: [{ type: 'context-loaded', slot: 'skill', key: 'commit', content: 'commit prose' }],
    })
    await Bun.sleep(20)

    expect(app.appended).toEqual([
      { type: 'context-loaded', slot: 'skill', key: 'commit', content: 'commit prose' },
      {
        type: 'user-said',
        text: 'go',
        images: [
          { path: '/tmp/shot.png', mediaType: 'image/png', data: 'aGVsbG8=', width: 2, height: 1 },
        ],
      },
    ])
  })

  it('answers a publish-workspace request with the ref the workspace pushed', async () => {
    const { handle } = await start({
      publishWorkspace: async () => ({
        ref: 'refs/atlas/descend/thread-serve-0123456789ab',
        commit: '0123456789abcdef',
        base: 'ba51e1e0ba51e1e0ba51e1e0ba51e1e0ba51e1e0',
        baseTree: '7ee1ab1e7ee1ab1e7ee1ab1e7ee1ab1e7ee1ab1e',
        branch: 'dennis/feature',
      }),
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({
      kind: EClientFrame.Request,
      id: 'pub-1',
      op: EClientRequest.PublishWorkspace,
      params: {},
    })
    const reply = await client.waitFor((frame) => frame.kind === EServeFrame.Reply)

    expect(reply).toEqual({
      kind: EServeFrame.Reply,
      replyTo: 'pub-1',
      ok: true,
      data: {
        ref: 'refs/atlas/descend/thread-serve-0123456789ab',
        commit: '0123456789abcdef',
        base: 'ba51e1e0ba51e1e0ba51e1e0ba51e1e0ba51e1e0',
        baseTree: '7ee1ab1e7ee1ab1e7ee1ab1e7ee1ab1e7ee1ab1e',
        branch: 'dennis/feature',
      },
    })
  })

  it('re-fetches the workspace spec on every publish, so a rotated token self-heals on retry', async () => {
    let specFetches = 0
    const { handle } = await start({
      workspace: { state: EWorkspaceState.Materialized },
      fetchFn: (async (input: unknown) => {
        if (String(input).endsWith('/workspace')) {
          specFetches += 1
          return new Response(
            JSON.stringify({
              remoteUrl: null,
              branch: null,
              commit: null,
              patch: '',
              githubToken: null,
              contextBundle: null,
            }),
          )
        }
        return new Response(null, { status: 204 })
      }) as typeof fetch,
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    const ask = (id: string) =>
      client.send({ kind: EClientFrame.Request, id, op: EClientRequest.PublishWorkspace, params: {} })
    ask('pub-1')
    await client.waitFor((frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'pub-1')
    ask('pub-2')
    const reply = await client.waitFor(
      (frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'pub-2',
    )

    expect(reply).toMatchObject({ ok: true, data: null })
    expect(specFetches).toBe(3)
  })

  it('answers publish-workspace with null when no workspace materialized', async () => {
    const { handle } = await start({})

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({
      kind: EClientFrame.Request,
      id: 'pub-1',
      op: EClientRequest.PublishWorkspace,
      params: {},
    })
    const reply = await client.waitFor((frame) => frame.kind === EServeFrame.Reply)

    expect(reply).toEqual({ kind: EServeFrame.Reply, replyTo: 'pub-1', ok: true, data: null })
  })

  it('boots from the variables the sandbox was created with, and logs none of them', async () => {
    const { handle, lines } = await start({
      env: {
        [EServeEnv.Token]: TOKEN,
        [EServeEnv.Port]: '0',
        [EServeEnv.ThreadId]: 'thread-serve',
        [EServeEnv.CloudUrl]: CONTROL_PLANE,
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    expect(lines.some((line) => line.includes(EServeEvent.Started))).toBe(true)
    expect(lines.some((line) => line.includes(TOKEN))).toBe(false)
  })

  it('closes and exits once the conversation has gone quiet past the idle TTL', async () => {
    const exits: number[] = []
    const { app, lines } = await start({
      idleMinutes: 0.001,
      idleTickMs: 5,
      exit: (code) => exits.push(code),
    })

    await Bun.sleep(200)

    expect(app.closed()).toBe(true)
    expect(exits).toEqual([0])
    expect(lines.some((line) => line.includes(EServeEvent.IdleStop))).toBe(true)
  })

  it('never parks itself mid-turn', async () => {
    let release = (): void => undefined
    const turn = new Promise<void>((resolve) => {
      release = resolve
    })
    const exits: number[] = []
    const { handle, app } = await start({
      idleMinutes: 0.001,
      idleTickMs: 5,
      exit: (code) => exits.push(code),
      runTurn: async () => {
        await turn
        return { status: ETurnStatus.Completed, runId: toRunId('run-1') }
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.send({ kind: EClientFrame.Send, text: 'go' })
    await Bun.sleep(100)

    expect(app.closed()).toBe(false)
    expect(exits).toEqual([])

    release()
    await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)
  })

  it('reports a workspace it could not materialize, and refuses to work in an empty tree', async () => {
    const { handle, lines } = await start({
      workspace: {
        state: EWorkspaceState.Failed,
        step: EWorkspaceStep.Clone,
        reason: 'fatal: repository not found',
      },
    })

    const health = await fetch(`http://127.0.0.1:${handle.port}/v1/health`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(await health.json()).toMatchObject({
      ok: false,
      workspace: { state: EWorkspaceState.Failed, step: EWorkspaceStep.Clone },
    })
    expect(lines.some((line) => line.includes(EServeEvent.WorkspaceFailed))).toBe(true)

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Send, text: 'go' })
    const refusal = await client.waitFor((frame) => frame.kind === EServeFrame.Error)

    expect(refusal).toMatchObject({ kind: EServeFrame.Error })
    expect(JSON.stringify(refusal)).toContain('fatal: repository not found')
  })

  it('announces a failed workspace on hello, before anyone speaks', async () => {
    const { handle } = await start({
      workspace: {
        state: EWorkspaceState.Failed,
        step: EWorkspaceStep.Clone,
        reason: 'fatal: repository not found',
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    const announced = await client.waitFor((frame) => frame.kind === EServeFrame.Error)

    expect(JSON.stringify(announced)).toContain('fatal: repository not found')
  })

  it('logs the workspace it found already materialized', async () => {
    const { lines } = await start({ workspace: { state: EWorkspaceState.Present } })

    expect(
      lines.some(
        (line) =>
          line.includes(EServeEvent.WorkspaceReady) && line.includes(EWorkspaceState.Present),
      ),
    ).toBe(true)
  })

  it('times the workspace materialization in its boot log', async () => {
    const ensureWorkspace: EnsureWorkspace = async () => {
      await Bun.sleep(30)
      return { state: EWorkspaceState.Skipped }
    }
    const { lines } = await start({ ensureWorkspace })

    const ready = lines.find((line) => line.includes(EServeEvent.WorkspaceReady))
    const ms: unknown = JSON.parse(ready ?? '{}').ms
    expect(typeof ms).toBe('number')
    expect(ms).toBeGreaterThanOrEqual(20)
  })

  it('times the context materialization in its boot log', async () => {
    const { lines } = await start({})

    const context = lines.find(
      (line) =>
        line.includes(EServeEvent.ContextReady) || line.includes(EServeEvent.ContextFailed),
    )
    expect(context).toBeDefined()
    expect(JSON.parse(context ?? '{}').ms).toEqual(expect.any(Number))
  })

  it('stamps the whole boot on the started line', async () => {
    const { lines } = await start({})

    const started = lines.find((line) => line.includes(EServeEvent.Started))
    expect(JSON.parse(started ?? '{}').ms).toEqual(expect.any(Number))
  })

  it("adopts the thread's transferred children on boot, before anyone connects", async () => {
    const { app } = await start({
      adoptChildren: async () => [toThreadId('thread-child')],
    })

    expect(app.adoptions()).toEqual([threadId])
  })

  it('serves the socket even when child adoption fails, and only logs it', async () => {
    const { handle, lines } = await start({
      adoptChildren: () => Promise.reject(new Error('control plane unreachable')),
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    expect(
      lines.some(
        (line) =>
          line.includes(EServeEvent.ChildAdoptionFailed) &&
          line.includes('control plane unreachable'),
      ),
    ).toBe(true)
  })

  it('runs a turn from the log head on a run frame, commits nothing, and answers with the outcome', async () => {
    const { handle, app } = await start({
      runTurn: async () => ({ status: ETurnStatus.Completed, runId: toRunId('run-1') }),
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Run })
    const ended = await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)

    expect(ended).toEqual({
      kind: EServeFrame.TurnEnded,
      outcome: { status: ETurnStatus.Completed, runId: toRunId('run-1') },
    })
    expect(app.appended).toEqual([])
  })

  it('replays the turn-ended a disconnected client missed, settling its waiter before the next turn', async () => {
    const held = gate()
    let turns = 0
    const { handle, app, lines } = await start({
      runTurn: async () => {
        turns += 1
        const publisher = app.channel.publisherFor({ threadId })
        publisher.onChunk(textChunk('one'))
        if (turns === 1) await held.opened
        publisher.onChunk(textChunk('two'))
        return { status: ETurnStatus.Completed, runId: toRunId(`run-${turns}`) }
      },
    })

    const first = await connect({ port: handle.port, token: TOKEN })
    first.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await first.waitFor((frame) => frame.kind === EServeFrame.Ready)
    first.send({ kind: EClientFrame.Run })
    await first.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.seq === 1)
    first.close()
    await first.closed

    held.open()
    for (let waited = 0; waited < 2000; waited += 1) {
      if (lines.some((line) => line.includes(EServeEvent.TurnEnded))) break
      await Bun.sleep(1)
    }

    const second = await connect({ port: handle.port, token: TOKEN })
    second.send(hello({ channelCursor: 1, lastEventSeq: 0 }))
    const replayed = await second.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)

    expect(replayed).toEqual({
      kind: EServeFrame.TurnEnded,
      outcome: { status: ETurnStatus.Completed, runId: toRunId('run-1') },
    })
    expect(second.frames.map((frame) => frame.kind)).toEqual([
      EServeFrame.Ready,
      EServeFrame.Signal,
      EServeFrame.TurnEnded,
    ])

    second.send({ kind: EClientFrame.Run })
    await second.waitFor(
      (frame) => frame.kind === EServeFrame.TurnEnded && frame.outcome.runId === toRunId('run-2'),
    )
    expect(turns).toBe(2)
  })

  it('replays the error a disconnected client missed when its turn failed', async () => {
    const held = gate()
    const { handle, app, lines } = await start({
      runTurn: async () => {
        const publisher = app.channel.publisherFor({ threadId })
        publisher.onChunk(textChunk('one'))
        await held.opened
        throw new Error('the control plane answered 401')
      },
    })

    const first = await connect({ port: handle.port, token: TOKEN })
    first.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await first.waitFor((frame) => frame.kind === EServeFrame.Ready)
    first.send({ kind: EClientFrame.Run })
    await first.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.seq === 1)
    first.close()
    await first.closed

    held.open()
    for (let waited = 0; waited < 2000; waited += 1) {
      if (lines.some((line) => line.includes(EServeEvent.TurnFailed))) break
      await Bun.sleep(1)
    }

    const second = await connect({ port: handle.port, token: TOKEN })
    second.send(hello({ channelCursor: 1, lastEventSeq: 0 }))
    const failure = await second.waitFor((frame) => frame.kind === EServeFrame.Error)

    expect(failure).toEqual({ kind: EServeFrame.Error, message: 'the control plane answered 401' })
  })

  it('runs a queued turn again when a run frame arrives mid-turn', async () => {
    const held = gate()
    let turns = 0
    const { handle } = await start({
      runTurn: async () => {
        turns += 1
        if (turns === 1) await held.opened
        return { status: ETurnStatus.Completed, runId: toRunId(`run-${turns}`) }
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Run })
    await Bun.sleep(10)
    client.send({ kind: EClientFrame.Run })
    held.open()

    await client.waitFor(
      (frame) => frame.kind === EServeFrame.TurnEnded && frame.outcome.runId === 'run-2',
    )
    expect(turns).toBe(2)
  })

  it('refuses a run frame when the workspace failed to materialize', async () => {
    const { handle } = await start({
      workspace: {
        state: EWorkspaceState.Failed,
        step: EWorkspaceStep.Clone,
        reason: 'fatal: repository not found',
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    await client.waitFor((frame) => frame.kind === EServeFrame.Error)

    client.send({ kind: EClientFrame.Run })
    const refusal = await client.waitFor((frame) => frame.kind === EServeFrame.Error)
    expect(JSON.stringify(refusal)).toContain('fatal: repository not found')
  })

  it('answers a turn that throws with the reason, not silence', async () => {
    const { handle } = await start({
      runTurn: async () => {
        throw new Error('the control plane answered 401')
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Run })
    const failure = await client.waitFor((frame) => frame.kind === EServeFrame.Error)

    expect(failure).toEqual({ kind: EServeFrame.Error, message: 'the control plane answered 401' })
  })

  it('interrupts the turn a client asked it to stop', async () => {
    let aborted = false
    const { handle } = await start({
      runTurn: async ({ signal }) => {
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()))
        aborted = true
        return { status: ETurnStatus.Interrupted, runId: toRunId('run-1'), committed: false }
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Send, text: 'go' })
    await Bun.sleep(10)
    client.send({ kind: EClientFrame.Interrupt })

    const acked = await client.waitFor((frame) => frame.kind === EServeFrame.InterruptAcked)
    if (acked.kind === EServeFrame.InterruptAcked) expect(acked.seq).toBeGreaterThanOrEqual(0)
    expect(aborted).toBe(true)
  })

  it('gives up draining a step that ignores its abort, once the drain deadline lapses', async () => {
    const app = fakeServeApp({
      threadId,
      root: '/workspace',
      runTurn: () => new Promise<TurnOutcome>(() => undefined),
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
      fetchFn: (async (_input: unknown) => new Response(null, { status: 204 })) as typeof fetch,
      drainDeadlineMs: 5,
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.send({ kind: EClientFrame.Run })
    await Bun.sleep(10)

    const startedAt = Date.now()
    await handle.close()

    expect(Date.now() - startedAt).toBeLessThan(200)
  })

  it('reads the thread model from the control plane when none is given', async () => {
    let composedWith: string | undefined
    const app = fakeServeApp({ threadId, root: '/workspace' })

    const handle = await startServe({
      threadId,
      port: 0,
      token: TOKEN,
      controlPlaneUrl: CONTROL_PLANE,
      env: {},
      cwd: '/workspace',
      compose: async (args) => {
        composedWith = args.model
        return app
      },
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      fetchFn: (async (input: unknown) => {
        const url = String(input)
        if (url.endsWith(`/v1/threads/${threadId}`)) {
          return new Response(
            JSON.stringify({
              id: threadId,
              head: 0,
              createdAt: '2026-09-21T00:00:00.000Z',
              updatedAt: '2026-09-21T00:00:00.000Z',
              workspace: '/workspace',
              repo: null,
              model: { ref: 'inference-net/kimi-k3-fast', effort: 'high' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(null, { status: 204 })
      }) as typeof fetch,
    })

    expect(composedWith).toBe('inference-net/kimi-k3-fast')
    await handle.close()
  })

  it('prefers an explicit model over the thread store', async () => {
    let composedWith: string | undefined
    const app = fakeServeApp({ threadId, root: '/workspace' })

    const handle = await startServe({
      threadId,
      port: 0,
      token: TOKEN,
      controlPlaneUrl: CONTROL_PLANE,
      env: {},
      cwd: '/workspace',
      model: 'anthropic/claude-sonnet-4-5',
      compose: async (args) => {
        composedWith = args.model
        return app
      },
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      fetchFn: (async (_input: unknown) =>
        new Response(null, { status: 204 })) as unknown as typeof fetch,
    })

    expect(composedWith).toBe('anthropic/claude-sonnet-4-5')
    await handle.close()
  })

  it('composes with no model when the thread has none stored', async () => {
    let composedWith: string | undefined
    const app = fakeServeApp({ threadId, root: '/workspace' })

    const handle = await startServe({
      threadId,
      port: 0,
      token: TOKEN,
      controlPlaneUrl: CONTROL_PLANE,
      env: {},
      cwd: '/workspace',
      compose: async (args) => {
        composedWith = args.model
        return app
      },
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      fetchFn: (async (input: unknown) => {
        const url = String(input)
        if (url.endsWith(`/v1/threads/${threadId}`)) {
          return new Response(
            JSON.stringify({
              id: threadId,
              head: 0,
              createdAt: '2026-09-21T00:00:00.000Z',
              updatedAt: '2026-09-21T00:00:00.000Z',
              workspace: '/workspace',
              repo: null,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(null, { status: 204 })
      }) as typeof fetch,
    })

    expect(composedWith).toBeUndefined()
    await handle.close()
  })

  it('hands the profile capabilities to compose when the readiness carries them', async () => {
    const capabilities: EnvironmentCapabilities = {
      canPush: true,
      gitIdentity: 'Operator <operator@example.com>',
      gpgSigning: true,
      dockerAvailable: false,
      persistentFs: true,
      serviceTtlSeconds: 1800,
      portExposure: EPortExposure.PublicDomain,
      failures: [],
    }
    let composedWith: EnvironmentCapabilities | undefined
    const app = fakeServeApp({ threadId, root: '/workspace' })

    const handle = await startServe({
      threadId,
      port: 0,
      token: TOKEN,
      controlPlaneUrl: CONTROL_PLANE,
      env: {},
      cwd: '/workspace',
      compose: async (args) => {
        composedWith = args.capabilities
        return app
      },
      ensureWorkspace: async () => ({
        state: EWorkspaceState.Materialized,
        profile: { steps: [], capabilities },
      }),
      fetchFn: (async (_input: unknown) => new Response(null, { status: 204 })) as typeof fetch,
    })

    expect(composedWith).toEqual(capabilities)
    await handle.close()
  })

  it('composes without capabilities when the workspace failed before profiling', async () => {
    let composed = false
    let composedWith: EnvironmentCapabilities | undefined
    const app = fakeServeApp({ threadId, root: '/workspace' })

    const handle = await startServe({
      threadId,
      port: 0,
      token: TOKEN,
      controlPlaneUrl: CONTROL_PLANE,
      env: {},
      cwd: '/workspace',
      compose: async (args) => {
        composed = true
        composedWith = args.capabilities
        return app
      },
      ensureWorkspace: async () => ({
        state: EWorkspaceState.Failed,
        step: EWorkspaceStep.Clone,
        reason: 'fatal: repository not found',
      }),
      fetchFn: (async (_input: unknown) => new Response(null, { status: 204 })) as typeof fetch,
    })

    expect(composed).toBe(true)
    expect(composedWith).toBeUndefined()
    await handle.close()
  })

  describe('an ending that lands while no client is attached', () => {
    it('starts a turn on a shell ending rather than waiting for a Send', async () => {
      let turns = 0
      const { app, lines } = await start({
        wakeNotices: true,
        runTurn: async () => {
          turns += 1
          return { status: ETurnStatus.Completed, runId: toRunId(`run-${turns}`) }
        },
      })

      wakeNoticesOf(app).setPending({ shells: 1 })

      for (let waited = 0; waited < 2000; waited += 1) {
        if (turns > 0) break
        await Bun.sleep(1)
      }

      expect(turns).toBe(1)
      expect(lines.some((line) => line.includes(EServeEvent.TurnStarted))).toBe(true)
    })

    it('holds the wake while a turn is already running — the loop drains the queue itself', async () => {
      const held = gate()
      let turns = 0
      const { handle, app } = await start({
        wakeNotices: true,
        runTurn: async () => {
          turns += 1
          await held.opened
          return { status: ETurnStatus.Completed, runId: toRunId(`run-${turns}`) }
        },
      })

      const client = await connect({ port: handle.port, token: TOKEN })
      client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
      await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
      client.send({ kind: EClientFrame.Run })
      await Bun.sleep(10)

      wakeNoticesOf(app).setPending({ shells: 1 })
      await Bun.sleep(10)
      expect(turns).toBe(1)

      held.open()
      wakeNoticesOf(app).setPending({ shells: 0 })
      await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)
      expect(turns).toBe(1)
    })
  })
})
