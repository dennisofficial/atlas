import { createHash } from 'node:crypto'

import { ChangeContentStore, ControlPlane } from '@dltech/atlas-control'
import { FakeChangeContentStore, InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  EChangeFileStatus,
  EChangeSide,
  type ChangePathEntry,
  type ChangesManifest,
} from '@dltech/atlas-protocol'
import { defineOp, type DaemonGroupFactory } from '@dltech/atlas-protocol/engine'
import {
  createInMemoryDaemon,
  inMemoryDaemonToken,
  type InMemoryDaemonSocket,
} from '@dltech/atlas-protocol/testing'
import type { LogPort } from '@dltech/atlas-observability'
import { describe, expect, it } from 'bun:test'

import { RemoteCalls } from '../../../calls/remote-calls'
import type { DaemonConnector } from '../../../calls/socket'
import { FakeClock, SANDBOX, SECRET } from '../../__tests__/rig-fakes'
import { changeCheckoutId } from '../identity'
import { ChangesSnapshotter } from '../snapshotter'

const SESSION = 'session-changes'
const REPO = 'github.com/org/repo'
const WORKTREE = '/w'
const BASE = 'aaa111'

const until = async (ready: () => boolean): Promise<void> => {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('the snapshotter never caught up')
}

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

const entryOf = (args: Partial<ChangePathEntry> & { path: string }): ChangePathEntry => ({
  oldPath: null,
  status: EChangeFileStatus.Modified,
  additions: 1,
  deletions: 0,
  binary: false,
  baseHash: null,
  currentHash: null,
  baseSize: null,
  currentSize: null,
  ...args,
})

type DaemonState = {
  manifest: ChangesManifest
  contents: Map<string, Uint8Array>
  scans: number
  reads: number
  gate: (() => Promise<void>) | undefined
  inFlight: number
  peak: number
}

const daemonState = (manifest: ChangesManifest): DaemonState => ({
  manifest,
  contents: new Map(),
  scans: 0,
  reads: 0,
  gate: undefined,
  inFlight: 0,
  peak: 0,
})

const changesGroup =
  (state: DaemonState): DaemonGroupFactory =>
  () => ({
    name: 'changes',
    ops: [
      defineOp({
        op: 'changes.scan',
        run: async () => {
          state.scans += 1
          state.inFlight += 1
          state.peak = Math.max(state.peak, state.inFlight)
          try {
            if (state.gate !== undefined) await state.gate()
            return state.manifest
          } finally {
            state.inFlight -= 1
          }
        },
      }),
      defineOp({
        op: 'changes.read',
        run: async ({ op }) => {
          state.reads += 1
          const bytes = state.contents.get(`${op.path}:${op.side}`) ?? bytesOf('')
          return {
            hash: sha(bytes),
            size: bytes.byteLength,
            base64: Buffer.from(bytes).toString('base64'),
          }
        },
      }),
    ],
  })

const connect = async (state: DaemonState): Promise<RemoteCalls> => {
  const daemon = await createInMemoryDaemon({
    version: 'test',
    sandboxName: SANDBOX,
    secret: SECRET,
    groups: () => [changesGroup(state)],
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

type Rig = {
  state: DaemonState
  errors: string[]
  plane: ControlPlane
  writes: number[]
  content: FakeChangeContentStore
  snapshotter: ChangesSnapshotter
  calls: RemoteCalls
}

const rig = async (args: { state: DaemonState; content?: ChangeContentStore }): Promise<Rig> => {
  const store = new InMemoryControlStore({ clock: () => new Date(0).toISOString() })
  const plane = new ControlPlane({ store })
  const writes: number[] = []
  const write = plane.upsertChanges.bind(plane)
  plane.upsertChanges = async (params) => {
    writes.push(params.blobs.length)
    await write(params)
  }
  const content = args.content ?? new FakeChangeContentStore({ clock: () => 1 })
  const errors: string[] = []
  const calls = await connect(args.state)
  const snapshotter = new ChangesSnapshotter({
    sessionId: SESSION,
    plane,
    content,
    remoteCalls: calls,
    checkouts: async () => [
      { repoPath: WORKTREE, originUrl: 'git@github.com:org/repo.git', base: BASE },
    ],
    now: () => 1_700_000_000_000,
    log: {
      error: (entry: { message: string; data?: unknown }) => {
        errors.push(`${entry.message} ${JSON.stringify(entry.data ?? {})} ${JSON.stringify(entry)}`)
      },
    } as unknown as LogPort,
  })
  return {
    state: args.state,
    errors,
    plane,
    writes,
    content: content as FakeChangeContentStore,
    snapshotter,
    calls,
  }
}

const singleFile = (): DaemonState => {
  const before = bytesOf('one\n')
  const after = bytesOf('one\ntwo\n')
  const state = daemonState({
    repoPath: WORKTREE,
    base: BASE,
    files: [
      entryOf({
        path: 'a.txt',
        baseHash: sha(before),
        currentHash: sha(after),
        baseSize: before.byteLength,
        currentSize: after.byteLength,
      }),
    ],
  })
  state.contents.set(`a.txt:${EChangeSide.Base}`, before)
  state.contents.set(`a.txt:${EChangeSide.Current}`, after)
  return state
}

describe('ChangesSnapshotter', () => {
  it('uploads only the missing hashes once and leaves an identical snapshot alone', async () => {
    const state = singleFile()
    const { snapshotter, content, writes, plane, calls, errors } = await rig({ state })

    await snapshotter.snapshotNow()
    expect(errors).toEqual([])
    const before = bytesOf('one\n')
    expect(content.puts).toEqual([sha(before), sha(bytesOf('one\ntwo\n'))])
    expect(writes).toHaveLength(1)
    const [checkout] = await plane.readChanges({ sessionId: SESSION })
    expect(checkout?.checkoutId).toBe(changeCheckoutId({ repo: REPO, worktreePath: WORKTREE }))
    expect(checkout?.repo).toBe(REPO)
    expect(checkout?.base).toBe(BASE)
    expect(checkout?.files[0]).toMatchObject({
      path: 'a.txt',
      status: EChangeFileStatus.Modified,
      size: 8,
    })

    await snapshotter.snapshotNow()
    expect(content.puts).toHaveLength(2)
    expect(writes).toHaveLength(1)
    calls.close()
  })

  it('writes and notifies nothing when the content store rejects the upload', async () => {
    class FailingStore extends FakeChangeContentStore {
      override put(): Promise<void> {
        return Promise.reject(new Error('bucket is down'))
      }
    }
    const state = singleFile()
    const { snapshotter, writes, plane, calls } = await rig({ state, content: new FailingStore() })

    await snapshotter.snapshotNow()

    expect(writes).toHaveLength(0)
    expect(await plane.readChanges({ sessionId: SESSION })).toHaveLength(0)
    calls.close()
  })

  it('replaces the file rows when the worktree loses its only change', async () => {
    const state = singleFile()
    const { snapshotter, plane, writes, calls } = await rig({ state })

    await snapshotter.snapshotNow()
    state.manifest = { repoPath: WORKTREE, base: BASE, files: [] }
    await snapshotter.snapshotNow()

    expect(writes).toHaveLength(2)
    const [checkout] = await plane.readChanges({ sessionId: SESSION })
    expect(checkout?.files).toEqual([])
    calls.close()
  })

  it('coalesces a second request into one queued scan instead of running two at once', async () => {
    const state = singleFile()
    const { snapshotter, calls } = await rig({ state })
    let open: () => void = () => undefined
    state.gate = () =>
      new Promise<void>((resolve) => {
        open = resolve
      })

    const first = snapshotter.snapshotNow()
    const second = snapshotter.snapshotNow()
    await until(() => state.scans === 1)
    state.gate = undefined
    open()
    await first
    await second
    await until(() => state.scans === 2)

    expect(state.scans).toBe(2)
    expect(state.peak).toBe(1)
    calls.close()
  })
})
