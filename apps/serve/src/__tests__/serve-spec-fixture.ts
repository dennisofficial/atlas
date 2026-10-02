import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'

import { EClientFrame, EServeFrame, type ServeFrame } from '@dltech/atlas-harness'
import {
  EWorkspaceState,
  startServe,
  type EnsureWorkspace,
  type ServeHandle,
  type WorkspaceFiles,
  type WorkspacePublisher,
  type WorkspaceReadiness,
} from '../index'

import { fakeRoster, fakeServeApp, type FakeServeApp, type fakeWakeNotices, type RunTurn } from './fakes'

export const TOKEN = 'session-token'

export const threadId = toThreadId('thread-serve')

export const CONTROL_PLANE = 'https://api.example.com'

const driveHomes: string[] = []
let heldAtlasHome: string | undefined

const writeDriveSpec = async (args: {
  home: string
  spec?: Record<string, unknown> | undefined
}): Promise<void> => {
  const bootstrap = join(args.home, 'bootstrap')
  await mkdir(bootstrap, { recursive: true })
  await writeFile(
    join(bootstrap, 'workspace-spec.json'),
    JSON.stringify({
      remoteUrl: null,
      branch: null,
      commit: null,
      patch: '',
      githubToken: null,
      contextBundle: null,
      ...args.spec,
    }),
  )
}

export const startWithDriveSpec = async (args: {
  spec?: Record<string, unknown> | undefined
  compose: (composeArgs: { model?: { ref: string; effort?: string | undefined } | undefined }) => Promise<FakeServeApp>
}): Promise<ServeHandle> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-spec-home-'))
  driveHomes.push(home)
  heldAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  await writeDriveSpec({ home, spec: args.spec })
  const handle = await startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: CONTROL_PLANE,
    env: {},
    cwd: '/workspace',
    compose: args.compose,
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    contextFiles: inMemoryContextFiles(),
  })
  running.push(handle)
  return handle
}

export type Started = { handle: ServeHandle; app: FakeServeApp; lines: string[] }

const running: ServeHandle[] = []

/**
 * `startServe` defaults its context materialization to the real filesystem, so a spec that never
 * injects one would otherwise stamp the developer's own Atlas home the moment a fetchFn override
 * lets the workspace spec resolve.
 */
export const inMemoryContextFiles = (): WorkspaceFiles => {
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

export const start = async (args: {
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
  roster?: ReturnType<typeof fakeRoster> | undefined
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
    roster: args.roster,
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

export const hello = (args: { channelCursor: number | null; lastEventSeq: number; protocol?: number }) =>
  ({ kind: EClientFrame.Hello, threadId, ...args }) as const

export const seqsOf = (frames: readonly ServeFrame[]): number[] =>
  frames.flatMap((frame) => (frame.kind === EServeFrame.Signal ? [frame.seq] : []))

export const stepIdsOf = (frames: readonly ServeFrame[]): string[] =>
  frames.flatMap((frame) => {
    if (frame.kind !== EServeFrame.Signal) return []
    const { signal } = frame
    if (signal.type === 'step-started' || signal.type === 'chunk') return [signal.stepId]
    if (signal.type === 'step-ended') return [signal.stepId]
    return []
  })

export const isStep = (frame: ServeFrame, type: 'chunk' | 'step-ended'): boolean =>
  frame.kind === EServeFrame.Signal && frame.signal.type === type

export const wakeNoticesOf = (app: FakeServeApp): ReturnType<typeof fakeWakeNotices> => {
  if (app.wakeNotices === undefined) throw new Error('the spec did not ask for wakeNotices')
  return app.wakeNotices as ReturnType<typeof fakeWakeNotices>
}

export const textChunk = (text: string) => ({ type: 'text-delta', id: 'block', text }) as const

export const gate = () => {
  let open = (): void => undefined
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open: () => open() }
}

export const releaseServeSpec = async (): Promise<void> => {
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
  while (running.length > 0) await running.pop()?.close()
  for (const home of driveHomes.splice(0, driveHomes.length)) {
    rmSync(home, { recursive: true, force: true })
  }
}
