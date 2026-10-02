import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'

import {
  createRemoteDeltaChannel,
  decodeServeFrame,
  EChannelConnection,
  EServeFrame,
  type ChannelReload,
  type ChannelSocketFactory,
  type RemoteDeltaChannel,
  type ServeFrame,
  type TurnOutcome,
} from '@dltech/atlas-harness'

import { EWorkspaceState, startServe, type ServeHandle, type WorkspaceFiles } from '../index'

import { fakeServeApp, type FakeServeApp, type RunTurn } from './fakes'
import { settlingPolicy } from './settling-policy'

export const TOKEN = 'session-token'
export const threadId = toThreadId('thread-remote')
const PATIENCE_MS = 2_000

const homes: string[] = []
const running: ServeHandle[] = []
const channels: RemoteDeltaChannel[] = []
let heldAtlasHome: string | undefined

export const gate = () => {
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

export const until = async (args: { what: string; condition: () => boolean }): Promise<void> => {
  for (let waited = 0; waited < PATIENCE_MS; waited += 1) {
    if (args.condition()) return
    await Bun.sleep(1)
  }
  throw new Error(`waited too long for ${args.what}`)
}

export const startServing = async (args: {
  holdStep?: ((step: number) => Promise<void> | undefined) | undefined
  holdPolicy?: Promise<void> | undefined
  runTurn?: RunTurn | undefined
  family?: { pauseChildren: () => Promise<void> } | undefined
} = {}) => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-remote-home-'))
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

  const app: FakeServeApp = fakeServeApp({
    threadId,
    root: '/workspace',
    intake: true,
    holdStep: args.holdStep,
    runTurn: args.runTurn,
    family: args.family,
  })
  const held = args.holdPolicy
  const served: FakeServeApp =
    held === undefined ? app : { ...app, turnPolicy: settlingPolicy({ settled: held }) }
  const handle = await startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: 'https://api.example.com',
    env: {},
    cwd: '/workspace',
    compose: async () => served,
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    contextFiles: inMemoryContextFiles(),
    fetchFn: (async (_input: unknown) => new Response(null, { status: 204 })) as typeof fetch,
  })
  running.push(handle)
  return { handle, app }
}

export type Attached = {
  channel: RemoteDeltaChannel
  reloads: ChannelReload[]
  outcomes: TurnOutcome[]
  frames: ServeFrame[]
  retries: (() => void)[]
  drop: () => void
  workingNow: () => boolean
  readyInFlight: () => boolean | undefined
}

export const attach = async (args: {
  port: number
  dropFrame?: ((frame: ServeFrame) => boolean) | undefined
}): Promise<Attached> => {
  const frames: ServeFrame[] = []
  const retries: (() => void)[] = []
  let current: { close: () => void } | null = null

  const socketFactory: ChannelSocketFactory = ({ url, protocols, handlers }) => {
    const socket = new WebSocket(url, [...protocols])
    socket.onopen = () => handlers.handleOpen()
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      const frame = decodeServeFrame(event.data)
      if (frame !== null) frames.push(frame)
      if (frame !== null && args.dropFrame?.(frame) === true) return
      handlers.handleMessage(event.data)
    }
    socket.onclose = () => handlers.handleClose()
    socket.onerror = () => handlers.handleError('socket error')
    current = socket
    return {
      send: (data) => socket.send(data),
      close: () => socket.close(),
      isOpen: () => socket.readyState === WebSocket.OPEN,
    }
  }

  const channel = createRemoteDeltaChannel({
    threadId,
    url: `http://127.0.0.1:${args.port}`,
    token: TOKEN,
    socketFactory,
    scheduleRetry: (retry) => void retries.push(retry.run),
  })
  channels.push(channel)

  const reloads: ChannelReload[] = []
  const outcomes: TurnOutcome[] = []
  channel.onReload((reload) => void reloads.push(reload))
  channel.onTurnEnded((outcome) => void outcomes.push(outcome))
  await until({
    what: 'the channel to open',
    condition: () => channel.connection().state === EChannelConnection.Open,
  })
  await until({ what: 'the first attach to reload the log', condition: () => reloads.length === 1 })
  reloads.length = 0

  return {
    channel,
    reloads,
    outcomes,
    frames,
    retries,
    drop: () => current?.close(),
    workingNow: () =>
      channel.snapshot({ threadId }).some((signal) => signal.type === 'turn-working' && signal.working),
    readyInFlight: () => {
      const ready = frames.find((frame) => frame.kind === EServeFrame.Ready)
      return ready?.kind === EServeFrame.Ready ? ready.turnInFlight : undefined
    },
  }
}

export const releaseServing = async (): Promise<void> => {
  while (channels.length > 0) channels.pop()?.close()
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
  while (running.length > 0) await running.pop()?.close()
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
}
