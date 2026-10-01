import { afterEach, describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '@dltech/atlas-core'

import {
  createRemoteDeltaChannel,
  decodeServeFrame,
  EChannelConnection,
  EClientFrame,
  EServeFrame,
  ETurnStatus,
  type ChannelReload,
  type ChannelSocketFactory,
  type RemoteDeltaChannel,
  type ServeFrame,
} from '@dltech/atlas-harness'

import { EWorkspaceState, startServe, type ServeHandle, type WorkspaceFiles } from '../index'

import { connect, type TestClient } from './client'
import { fakeServeApp, type FakeServeApp } from './fakes'

const TOKEN = 'session-token'
const PATIENCE_MS = 2_000

const threadId = toThreadId('thread-lifecycle')

enum ETurnScript {
  Complete = 'complete',
  Fail = 'fail',
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

const until = async (predicate: () => boolean): Promise<void> => {
  const deadline = Date.now() + PATIENCE_MS
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waited too long for the condition')
    await Bun.sleep(1)
  }
}

const lineOf = (frame: ServeFrame): string[] => {
  if (frame.kind === EServeFrame.Signal) return [`signal:${frame.signal.type}`]
  if (frame.kind === EServeFrame.TurnEnded) return ['turn-ended']
  if (frame.kind === EServeFrame.Error) return [`error:${frame.message}`]
  return []
}

type Rig = {
  handle: ServeHandle
  app: FakeServeApp
  observer: TestClient
  channel: RemoteDeltaChannel
  seen: string[]
  reloads: ChannelReload[]
  sockets: WebSocket[]
  retries: (() => void)[]
  dropSignalSeqs: Set<number>
  runTurn: () => Promise<void>
  expectedLines: () => string[]
}

const running: ServeHandle[] = []
const channels: RemoteDeltaChannel[] = []

afterEach(async () => {
  for (const channel of channels.splice(0, channels.length)) channel.close()
  while (running.length > 0) await running.pop()?.close()
})

const rig = async (args: {
  script: readonly ETurnScript[]
  hold?: (() => Promise<void>) | undefined
}): Promise<Rig> => {
  const { script, hold } = args
  let turns = 0
  const holder: { app: FakeServeApp | null } = { app: null }
  const app = fakeServeApp({
    threadId,
    root: '/workspace',
    runTurn: async () => {
      const outcome = script[turns] ?? ETurnScript.Complete
      turns += 1
      const publisher = holder.app?.channel.publisherFor({ threadId })
      publisher?.turnWorking({ working: true })
      publisher?.onChunk({ type: 'text-delta', id: 'block', text: `turn ${turns}` })
      publisher?.turnWorking({ working: false })
      await hold?.()
      if (outcome === ETurnScript.Fail) throw new Error(`turn ${turns} failed`)
      return { status: ETurnStatus.Completed, runId: toRunId(`run-${turns}`) }
    },
  })
  holder.app = app

  const handle = await startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: 'https://api.example.com',
    env: {},
    cwd: '/workspace',
    write: () => undefined,
    fetchFn: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    compose: async () => app,
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    contextFiles: noFiles(),
  })
  running.push(handle)

  const observer = await connect({ port: handle.port, token: TOKEN })
  observer.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
  await observer.waitFor((frame) => frame.kind === EServeFrame.Ready)

  const seen: string[] = []
  const reloads: ChannelReload[] = []
  const sockets: WebSocket[] = []
  const retries: (() => void)[] = []
  const dropSignalSeqs = new Set<number>()

  const socketFactory: ChannelSocketFactory = ({ url, protocols, handlers }) => {
    const socket = new WebSocket(url, [...protocols])
    sockets.push(socket)
    socket.onopen = () => handlers.handleOpen()
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      const frame = decodeServeFrame(event.data)
      if (frame?.kind === EServeFrame.Signal && dropSignalSeqs.has(frame.seq)) return
      handlers.handleMessage(event.data)
    }
    socket.onclose = () => handlers.handleClose()
    socket.onerror = () => handlers.handleError('the session socket reported an error')
    return {
      send: (data) => socket.send(data),
      close: () => socket.close(),
      isOpen: () => socket.readyState === WebSocket.OPEN,
    }
  }

  const channel = createRemoteDeltaChannel({
    threadId,
    url: `http://127.0.0.1:${handle.port}`,
    token: TOKEN,
    socketFactory,
    scheduleRetry: ({ run }) => void retries.push(run),
  })
  channels.push(channel)
  channel.subscribe({ threadId, listener: (signal) => void seen.push(`signal:${signal.type}`) })
  channel.onTurnEnded(() => void seen.push('turn-ended'))
  channel.onServerError(({ message }) => void seen.push(`error:${message}`))
  channel.onReload((reload) => void reloads.push(reload))
  await until(() => channel.connection().state === EChannelConnection.Open)
  await until(() => reloads.length === 1)
  reloads.length = 0

  const lifecycleCount = (): number =>
    observer.frames.filter(
      (frame) => frame.kind === EServeFrame.TurnEnded || frame.kind === EServeFrame.Error,
    ).length

  return {
    handle,
    app,
    observer,
    channel,
    seen,
    reloads,
    sockets,
    retries,
    dropSignalSeqs,
    runTurn: async () => {
      const before = lifecycleCount()
      observer.send({ kind: EClientFrame.Run })
      await until(() => lifecycleCount() === before + 1)
    },
    expectedLines: () => observer.frames.flatMap(lineOf),
  }
}

describe('serve frame buffer through a real socket into RemoteDeltaChannel', () => {
  it('keeps the cursor contiguous across repeated turns, an error and the signals after them', async () => {
    const attached = await rig({
      script: [ETurnScript.Complete, ETurnScript.Fail, ETurnScript.Complete],
    })

    await attached.runTurn()
    await attached.runTurn()
    await attached.runTurn()
    await until(() => attached.seen.length === attached.expectedLines().length)

    expect(attached.reloads).toEqual([])
    expect(attached.seen).toEqual(attached.expectedLines())
    expect(attached.seen.filter((line) => line === 'turn-ended')).toHaveLength(2)
    expect(attached.seen).toContain('error:turn 2 failed')
    expect(attached.seen.at(-1)).toBe('turn-ended')
  })

  it('still reloads when a signal is really lost right after a turn-ended', async () => {
    const attached = await rig({ script: [ETurnScript.Complete, ETurnScript.Complete] })

    await attached.runTurn()
    await until(() => attached.seen.length === attached.expectedLines().length)
    const lastSeq = attached.observer.frames.flatMap((frame) =>
      frame.kind === EServeFrame.Signal ? [frame.seq] : [],
    ).at(-1)
    if (lastSeq === undefined) throw new Error('the first turn published no signal')

    attached.dropSignalSeqs.add(lastSeq + 1)
    await attached.runTurn()
    await until(() => attached.reloads.length === 1)

    expect(attached.reloads).toEqual([{ sinceEventSeq: 0 }])
    expect(attached.seen.length).toBeLessThan(attached.expectedLines().length)
  })

  it('resumes a reconnect without a reload, replaying lifecycle frames in order between signals', async () => {
    const attached = await rig({
      script: [ETurnScript.Complete, ETurnScript.Fail, ETurnScript.Complete],
    })
    const publisher = attached.app.channel.publisherFor({ threadId })
    publisher.turnWorking({ working: true })
    publisher.turnWorking({ working: false })
    await until(() => attached.seen.length === 2)

    attached.sockets.at(-1)?.close()
    await until(() => attached.retries.length === 1)

    await attached.runTurn()
    await attached.runTurn()
    await attached.runTurn()

    attached.retries.shift()?.()
    await until(() => attached.channel.connection().state === EChannelConnection.Open)
    await until(() => attached.seen.length === attached.expectedLines().length)

    expect(attached.reloads).toEqual([])
    expect(attached.seen).toEqual(attached.expectedLines())
    expect(attached.seen.filter((line) => line.startsWith('error:'))).toEqual(['error:turn 2 failed'])
    expect(attached.seen.at(-1)).toBe('turn-ended')
  })

  it('resumes a reconnect whose only missed frame is a turn-ended', async () => {
    let release = (): void => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const attached = await rig({ script: [ETurnScript.Complete], hold: () => held })

    attached.observer.send({ kind: EClientFrame.Run })
    await until(() => attached.seen.length === 4)

    attached.sockets.at(-1)?.close()
    await until(() => attached.retries.length === 1)
    release()
    await until(() => attached.observer.frames.some((frame) => frame.kind === EServeFrame.TurnEnded))

    attached.retries.shift()?.()
    await until(() => attached.seen.at(-1) === 'turn-ended')

    expect(attached.reloads).toEqual([])
    expect(attached.seen).toEqual(attached.expectedLines())
  })
})
