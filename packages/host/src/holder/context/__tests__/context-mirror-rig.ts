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
import {
  entriesOf,
  type FakeFs,
  fakeFs,
  HEAD_BYTES,
  NOW,
  SESSION,
  statOf,
} from './context-mirror-fs'

export {
  announceChanged,
  binaryOf,
  bytesOf,
  type FakeFile,
  type FakeFs,
  fakeFs,
  HEAD_BYTES,
  NOW,
  putDirectory,
  putFile,
  removeFile,
  ROOT,
  SESSION,
} from './context-mirror-fs'

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
          const file = fs.files.get(op.path)
          if (file === undefined) throw new Error(`ENOENT: ${op.path}`)
          return Buffer.from(file.bytes).toString('base64')
        },
      }),
      defineOp({
        op: 'digestFile',
        run: async ({ op }) => {
          fs.digests.push(op.path)
          if (fs.failDigests.has(op.path)) throw new Error(`EIO: ${op.path}`)
          const file = fs.files.get(op.path)
          if (file === undefined) throw new Error(`ENOENT: ${op.path}`)
          const hasher = new Bun.CryptoHasher('sha256')
          hasher.update(file.bytes)
          return {
            sha256: hasher.digest('hex'),
            size: file.size ?? file.bytes.byteLength,
            head: Buffer.from(file.bytes.subarray(0, HEAD_BYTES)).toString('base64'),
          }
        },
      }),
      defineOp({
        op: 'putFile',
        run: async ({ op }) => {
          const file = fs.files.get(op.path)
          if (file === undefined) throw new Error(`ENOENT: ${op.path}`)
          const hasher = new Bun.CryptoHasher('sha256')
          hasher.update(file.bytes)
          const response = await fetch(op.url, {
            method: 'PUT',
            body: file.bytes,
            headers: { 'content-type': 'application/octet-stream' },
          })
          if (!response.ok) throw new Error(`the store answered ${response.status}`)
          return { sha256: hasher.digest('hex'), size: file.bytes.byteLength }
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

  override exists(args: { hash: string }): Promise<boolean> {
    this.order.push(`exists:${args.hash}`)
    return super.exists(args)
  }

  override presignPut(args: { hash: string; ttlMs: number }): Promise<string> {
    this.order.push(`presignPut:${args.hash}`)
    return super.presignPut(args)
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
  const commit = plane.commitContextFile.bind(plane)
  plane.commitContextFile = async (params) => {
    const committed = await commit(params)
    order.push(`upsert:${params.write.path}`)
    return committed
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
