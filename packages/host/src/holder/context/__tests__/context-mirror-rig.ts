import { ContextContentStore, ControlPlane } from '@dltech/atlas-control'
import { FakeContextContentStore, InMemoryControlStore } from '@dltech/atlas-control/testing'
import { ELogSeverity, LogPort, type LogEntry } from '@dltech/atlas-observability'
import { defineOp, type DaemonGroupFactory } from '@dltech/atlas-protocol/engine'
import {
  createInMemoryDaemon,
  inMemoryDaemonToken,
  type InMemoryDaemonSocket,
} from '@dltech/atlas-protocol/testing'

import { RemoteCalls } from '../../../calls/remote-calls'
import type { DaemonConnector } from '../../../calls/socket'
import { FakeClock, SANDBOX, SECRET } from '../../__tests__/rig-fakes'
import { ContextMirror } from '../context-mirror'

export const SESSION = 'session-context'
export const ROOT = '/atlas/home/sessions/session-context/context'
export const NOW = 1_700_000_000_000

export type FakeFile = { bytes: Uint8Array; mtimeMs: number; size?: number | undefined }

export type FakeFs = {
  root: string
  files: Map<string, FakeFile>
  dirs: Set<string>
  reads: string[]
  scans: number
  failReads: Set<string>
  failDirs: Set<string>
  failStats: Set<string>
  onScan: (() => void) | undefined
  watchRoots: string[][]
  armed: string[]
  stopped: string[]
  changed: ((event: { watchId: string; paths: string[] }) => void) | undefined
}

export const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

export const binaryOf = (...values: readonly number[]): Uint8Array => new Uint8Array(values)

export const fakeFs = (): FakeFs => ({
  root: ROOT,
  files: new Map(),
  dirs: new Set([ROOT]),
  reads: [],
  scans: 0,
  failReads: new Set(),
  failDirs: new Set(),
  failStats: new Set(),
  onScan: undefined,
  watchRoots: [],
  armed: [],
  stopped: [],
  changed: undefined,
})

const absolute = (fs: FakeFs, path: string): string => `${fs.root}/${path}`

const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/'))
const ensureDirectories = (fs: FakeFs, path: string): void => {
  let directory = parentOf(path)
  while (directory.startsWith(fs.root) && !fs.dirs.has(directory)) {
    fs.dirs.add(directory)
    directory = parentOf(directory)
  }
}

export const putFile = (args: {
  fs: FakeFs
  path: string
  bytes?: Uint8Array | undefined
  text?: string | undefined
  mtimeMs?: number | undefined
  size?: number | undefined
}): void => {
  const path = absolute(args.fs, args.path)
  ensureDirectories(args.fs, path)
  args.fs.files.set(path, {
    bytes: args.bytes ?? bytesOf(args.text ?? ''),
    mtimeMs: args.mtimeMs ?? NOW,
    size: args.size,
  })
}

export const removeFile = (args: { fs: FakeFs; path: string }): void => {
  args.fs.files.delete(absolute(args.fs, args.path))
}

export const putDirectory = (args: { fs: FakeFs; path: string }): void => {
  args.fs.dirs.add(absolute(args.fs, args.path))
}

export const announceChanged = (args: {
  fs: FakeFs
  watchId: string
  paths?: readonly string[] | undefined
}): void => {
  args.fs.changed?.({ watchId: args.watchId, paths: [...(args.paths ?? [])] })
}

const entriesOf = (fs: FakeFs, directory: string) => {
  const entries: { name: string; isFile: boolean; isDirectory: boolean }[] = []
  for (const path of fs.files.keys()) {
    if (parentOf(path) !== directory) continue
    entries.push({ name: path.slice(path.lastIndexOf('/') + 1), isFile: true, isDirectory: false })
  }
  for (const path of fs.dirs) {
    if (path === directory || parentOf(path) !== directory) continue
    entries.push({ name: path.slice(path.lastIndexOf('/') + 1), isFile: false, isDirectory: true })
  }
  return entries
}

const statOf = (fs: FakeFs, path: string) => {
  const file = fs.files.get(path)
  if (file !== undefined) {
    return {
      size: file.size ?? file.bytes.byteLength,
      mode: 0o644,
      mtimeMs: file.mtimeMs,
      isFile: true,
      isDirectory: false,
    }
  }
  if (!fs.dirs.has(path)) throw new Error(`ENOENT: ${path}`)
  return { size: 0, mode: 0o755, mtimeMs: NOW, isFile: false, isDirectory: true }
}

const filesGroup =
  (fs: FakeFs): DaemonGroupFactory =>
  () => ({
    name: 'files',
    ops: [
      defineOp({
        op: 'stat',
        run: async ({ op }) => {
          if (fs.failStats.has(op.path)) throw new Error(`EIO: ${op.path}`)
          return statOf(fs, op.path)
        },
      }),
      defineOp({
        op: 'readDirectory',
        run: async ({ op }) => {
          fs.scans += 1
          if (fs.failDirs.has(op.path)) throw new Error(`EACCES: ${op.path}`)
          if (!fs.dirs.has(op.path)) throw new Error(`ENOENT: ${op.path}`)
          const entries = entriesOf(fs, op.path)
          fs.onScan?.()
          return entries
        },
      }),
      defineOp({
        op: 'readBytes',
        run: async ({ op }) => {
          fs.reads.push(op.path)
          if (fs.failReads.has(op.path)) throw new Error(`EIO: ${op.path}`)
          const file = fs.files.get(op.path)
          if (file === undefined) throw new Error(`ENOENT: ${op.path}`)
          return Buffer.from(file.bytes).toString('base64')
        },
      }),
    ],
  })

const watchGroup =
  (fs: FakeFs): DaemonGroupFactory =>
  (ctx) => {
    fs.changed = (event) => ctx.publish({ type: 'watch.changed', ...event })
    return {
      name: 'watch',
      ops: [
        defineOp({
          op: 'watch.start',
          run: async ({ op }) => {
            fs.armed.push(op.watchId)
            fs.watchRoots.push([...op.roots])
            return [...op.roots]
          },
        }),
        defineOp({
          op: 'watch.stop',
          run: async ({ op }) => {
            fs.stopped.push(op.watchId)
            return null
          },
        }),
      ],
    }
  }

const connect = async (fs: FakeFs): Promise<RemoteCalls> => {
  const daemon = await createInMemoryDaemon({
    version: 'test',
    sandboxName: SANDBOX,
    secret: SECRET,
    groups: () => [filesGroup(fs), watchGroup(fs)],
  })
  const calls = new RemoteCalls({
    sessionId: SESSION,
    token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
    connector: () =>
      Promise.resolve<DaemonConnector>((handlers) =>
        Promise.resolve<InMemoryDaemonSocket>(daemon.connectRaw(handlers)),
      ),
    timers: new FakeClock(),
    onFenced: () => {},
  })
  calls.open({ epoch: 1 })
  return calls
}

class RecordingContextContentStore extends FakeContextContentStore {
  constructor(private readonly order: string[]) {
    super({ clock: () => 1 })
  }

  override put(args: { hash: string; bytes: Uint8Array }): Promise<void> {
    this.order.push(`put:${args.hash}`)
    return super.put(args)
  }
}

export type ContextRig = {
  fs: FakeFs
  plane: ControlPlane
  content: FakeContextContentStore
  calls: RemoteCalls
  mirror: ContextMirror
  announces: string[][]
  errors: string[]
  order: string[]
}

class RigLog extends LogPort {
  constructor(private readonly errors: string[]) {
    super()
  }

  record(entry: LogEntry): void {
    if (entry.severity !== ELogSeverity.Error) return
    this.errors.push(`${entry.message} ${JSON.stringify(entry.data ?? {})}`)
  }
}

export const rig = async (args: {
  fs?: FakeFs | undefined
  content?: ContextContentStore | undefined
}): Promise<ContextRig> => {
  const fs = args.fs ?? fakeFs()
  const store = new InMemoryControlStore({ clock: () => new Date(0).toISOString() })
  const plane = new ControlPlane({ store })
  const order: string[] = []
  const publish = plane.publishContextFile.bind(plane)
  plane.publishContextFile = async (params) => {
    await publish(params)
    order.push(`upsert:${params.write.path}`)
  }
  const content = new RecordingContextContentStore(order)
  const calls = await connect(fs)
  const announces: string[][] = []
  const errors: string[] = []
  const mirror = new ContextMirror({
    sessionId: SESSION,
    root: fs.root,
    plane,
    content,
    remoteCalls: calls,
    announce: async (paths) => {
      announces.push([...paths])
    },
    log: new RigLog(errors),
    now: () => NOW,
  })
  return {
    fs,
    plane,
    content: content as FakeContextContentStore,
    calls,
    mirror,
    announces,
    errors,
    order,
  }
}

export const until = async (ready: () => Promise<boolean> | boolean): Promise<void> => {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    if (await ready()) return
    await settle(10)
  }
  throw new Error('the context mirror never caught up')
}

export const settle = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export const rowsOf = async (args: { plane: ControlPlane; sessionId?: string | undefined }) =>
  args.plane.listContextFiles({ sessionId: args.sessionId ?? SESSION })
