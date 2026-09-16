import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import {
  EChannelConnection,
  ThreadStorePort,
  type ChannelConnection,
} from '@dltech/atlas-harness'

import {
  fakeEventLog,
  fakeLedger,
  fakeThreadStore,
  type FakeEventLog,
  type FakeLedger,
  type FakeThreadStore,
} from '../../__tests__/fake-backend'
import {
  ECloudSandboxState,
  type CloudBridge,
  type CloudChannel,
  type CloudReload,
  type CloudSandbox,
  type CloudSandboxStatus,
  type LiftedWorkspace,
} from '../cloud-bridge'

export const CLOUD_THREAD = toThreadId('cloud-thread')

export const CLEAN_WORKSPACE: LiftedWorkspace = {
  remoteUrl: 'git@github.com:comp-ai/atlas.git',
  branch: 'dennis/container-cloud',
  commit: 'abc1234',
  patch: '',
}

export type FakeCloudChannel = CloudChannel & {
  moveTo(connection: ChannelConnection): void
  reload(reload: CloudReload): void
  fail(message: string): void
  readonly closed: boolean
}

export function fakeCloudChannel(args: { threadId?: ThreadId } = {}): FakeCloudChannel {
  const connections = new Set<(connection: ChannelConnection) => void>()
  const reloads = new Set<(reload: CloudReload) => void>()
  const failures = new Set<(failure: { message: string }) => void>()

  let held: ChannelConnection = { state: EChannelConnection.Connecting, detail: null }
  let closed = false

  return {
    threadId: args.threadId ?? CLOUD_THREAD,
    subscribe: () => () => undefined,
    snapshot: () => [],
    publisherFor: () => {
      throw new Error('a cloud channel never publishes from the client')
    },
    send: () => undefined,
    interrupt: () => undefined,
    request: async () => undefined,
    connection: () => held,
    onConnection: (listener) => {
      connections.add(listener)
      return () => {
        connections.delete(listener)
      }
    },
    onReload: (listener) => {
      reloads.add(listener)
      return () => {
        reloads.delete(listener)
      }
    },
    onError: (listener) => {
      failures.add(listener)
      return () => {
        failures.delete(listener)
      }
    },
    close: () => {
      closed = true
    },

    get closed() {
      return closed
    },

    moveTo(connection) {
      held = connection
      for (const listener of [...connections]) listener(connection)
    },
    reload(reload) {
      for (const listener of [...reloads]) listener(reload)
    },
    fail(message) {
      for (const listener of [...failures]) listener({ message })
    },
  }
}

/**
 * The order the lift does things in is the contract, so the two writes that move a thread are named
 * as they happen. Delegation rather than a spread: the port is a class, and a spread of one keeps
 * its fields and drops its methods.
 */
class WatchedThreadStore extends ThreadStorePort {
  private readonly inner: FakeThreadStore
  private readonly trail: string[]

  constructor(args: { inner: FakeThreadStore; trail: string[] }) {
    super()
    this.inner = args.inner
    this.trail = args.trail
  }

  create(args: Parameters<ThreadStorePort['create']>[0]) {
    return this.inner.create(args)
  }

  createWithFirstEvents(args: Parameters<ThreadStorePort['createWithFirstEvents']>[0]) {
    this.trail.push('transfer')
    return this.inner.createWithFirstEvents(args)
  }

  find(args: Parameters<ThreadStorePort['find']>[0]) {
    return this.inner.find(args)
  }

  spawned(args: Parameters<ThreadStorePort['spawned']>[0]) {
    return this.inner.spawned(args)
  }

  mostRecent(args: Parameters<ThreadStorePort['mostRecent']>[0]) {
    return this.inner.mostRecent(args)
  }

  list(args: Parameters<ThreadStorePort['list']>[0]) {
    return this.inner.list(args)
  }

  rename(args: Parameters<ThreadStorePort['rename']>[0]) {
    return this.inner.rename(args)
  }

  chooseModel(args: Parameters<ThreadStorePort['chooseModel']>[0]) {
    return this.inner.chooseModel(args)
  }

  chooseExecutionLocation(args: Parameters<ThreadStorePort['chooseExecutionLocation']>[0]) {
    this.trail.push('flip')
    return this.inner.chooseExecutionLocation(args)
  }

  adopt(args: Parameters<ThreadStorePort['adopt']>[0]) {
    return this.inner.adopt(args)
  }

  rewind(args: Parameters<ThreadStorePort['rewind']>[0]) {
    return this.inner.rewind(args)
  }

  compact(args: Parameters<ThreadStorePort['compact']>[0]) {
    return this.inner.compact(args)
  }

  summarise(args: Parameters<ThreadStorePort['summarise']>[0]) {
    return this.inner.summarise(args)
  }

  fork(args: Parameters<ThreadStorePort['fork']>[0]) {
    return this.inner.fork(args)
  }
}

export type FakeBridge = CloudBridge & {
  readonly log: FakeEventLog
  readonly threads: FakeThreadStore
  readonly ledger: FakeLedger
  readonly created: readonly { threadId: ThreadId; workspace: LiftedWorkspace | null }[]
  readonly attached: readonly { threadId: ThreadId; url: string; token: string }[]
  readonly channel: FakeCloudChannel
  readonly trail: readonly string[]
}

const RUNNING: CloudSandbox = {
  url: 'https://sandbox.example/thread',
  token: 'sandbox-token',
  state: ECloudSandboxState.Running,
}

export function fakeBridge(
  args: {
    sandbox?: CloudSandbox
    createFails?: unknown
    status?: CloudSandboxStatus | undefined
    threadStore?: FakeThreadStore
  } = {},
): FakeBridge {
  const log = fakeEventLog()
  const threads = args.threadStore ?? fakeThreadStore({ log })
  const ledger = fakeLedger()
  const channel = fakeCloudChannel()
  const created: { threadId: ThreadId; workspace: LiftedWorkspace | null }[] = []
  const attached: { threadId: ThreadId; url: string; token: string }[] = []
  const trail: string[] = []

  const watchedThreads = new WatchedThreadStore({ inner: threads, trail })

  return {
    log,
    threads,
    ledger,
    created,
    attached,
    channel,
    trail,
    stores: { log, threads: watchedThreads, ledger },
    sandboxes: {
      create: async ({ threadId, workspace }) => {
        trail.push('sandbox')
        created.push({ threadId, workspace })
        if (args.createFails !== undefined) throw args.createFails
        return args.sandbox ?? RUNNING
      },
      find: async () => args.status,
    },
    attach: ({ threadId, url, token }) => {
      trail.push('attach')
      attached.push({ threadId, url, token })
      return channel
    },
  }
}
