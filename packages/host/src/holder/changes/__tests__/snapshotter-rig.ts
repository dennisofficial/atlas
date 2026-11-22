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
import { ELogSeverity, LogPort, type LogEntry } from '@dltech/atlas-observability'

import { RemoteCalls } from '../../../calls/remote-calls'
import type { DaemonConnector } from '../../../calls/socket'
import { FakeClock, SANDBOX, SECRET } from '../../__tests__/rig-fakes'
import { ChangesSnapshotter, type ChangesCheckout } from '../snapshotter'

export const SESSION = 'session-changes'
export const REPO = 'github.com/org/repo'
export const WORKTREE = '/w'
export const SECOND_WORKTREE = '/w/.atlas/worktrees/b'
export const BASE = 'aaa111'

export const until = async (ready: () => boolean): Promise<void> => {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('the snapshotter never caught up')
}

export const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
export const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

export const entryOf = (args: Partial<ChangePathEntry> & { path: string }): ChangePathEntry => ({
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

export const daemonState = (manifest: ChangesManifest): DaemonState => ({
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

const watchGroup = (): DaemonGroupFactory => () => ({
  name: 'watch',
  ops: [
    defineOp({ op: 'watch.start', run: async ({ op }) => [...op.roots] }),
    defineOp({ op: 'watch.stop', run: async () => null }),
  ],
})

const connect = async (state: DaemonState): Promise<RemoteCalls> => {
  const daemon = await createInMemoryDaemon({
    version: 'test',
    sandboxName: SANDBOX,
    secret: SECRET,
    groups: () => [changesGroup(state), watchGroup()],
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

export type Rig = {
  state: DaemonState
  errors: string[]
  triggers: string[]
  plane: ControlPlane
  writes: number[]
  watchRoots: string[][]
  ops: string[]
  content: FakeChangeContentStore
  snapshotter: ChangesSnapshotter
  calls: RemoteCalls
}

class RigLog extends LogPort {
  constructor(
    private readonly errors: string[],
    private readonly triggers: string[],
  ) {
    super()
  }

  record(entry: LogEntry): void {
    const trigger = entry.data?.trigger
    if (typeof trigger === 'string') this.triggers.push(trigger)
    if (entry.severity !== ELogSeverity.Error) return
    this.errors.push(
      `${entry.message} ${JSON.stringify(entry.data ?? {})} ${JSON.stringify(entry)}`,
    )
  }
}

export const rig = async (args: {
  state: DaemonState
  content?: ChangeContentStore
  checkouts?: () => Promise<readonly ChangesCheckout[]>
}): Promise<Rig> => {
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
  const triggers: string[] = []
  const calls = await connect(args.state)
  const watchRoots: string[][] = []
  const ops: string[] = []
  const originalInvoke = calls.invoke.bind(calls)
  calls.invoke = async (params) => {
    ops.push(params.op.op)
    if (params.op.op === 'watch.start') watchRoots.push([...params.op.roots])
    return originalInvoke(params)
  }
  const snapshotter = new ChangesSnapshotter({
    sessionId: SESSION,
    plane,
    content,
    remoteCalls: calls,
    checkouts:
      args.checkouts ??
      (async () => [{ repoPath: WORKTREE, originUrl: 'git@github.com:org/repo.git', base: BASE }]),
    now: () => 1_700_000_000_000,
    log: new RigLog(errors, triggers),
  })
  return {
    state: args.state,
    errors,
    triggers,
    plane,
    writes,
    watchRoots,
    ops,
    content: content as FakeChangeContentStore,
    snapshotter,
    calls,
  }
}

export const singleFile = (): DaemonState => {
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
