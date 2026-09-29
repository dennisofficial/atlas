import { toRunId, toThreadId, type EventDraft, type SaidImage, type ThreadId } from '@dltech/atlas-core'
import type { RosterWire } from '@dltech/atlas-wire'
import {
  EChannelConnection,
  EClientRequest,
  RemoteThreadStore,
  ThreadStorePort,
  type ChannelConnection,
  type ChannelReady,
  type InterruptAck,
  type ThreadModel,
  type ThreadSummary,
  type TurnOutcome,
} from '@dltech/atlas-harness'

import {
  fakeEventLog,
  fakeLedger,
  fakeThreadStore,
  SPEC_SHARD,
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
} from '@dltech/atlas-harness'

export const CLOUD_THREAD = toThreadId(`cloud-thread-${SPEC_SHARD}`)

export const CLEAN_WORKSPACE: LiftedWorkspace = {
  remoteUrl: 'git@github.com:comp-ai/atlas.git',
  branch: 'dennis/container-cloud',
  commit: 'abc1234',
  patch: '',
}

export type FakeCloudChannel = CloudChannel & {
  /** What serve does with a send frame: the said lands in the remote log before the turn ends. */
  commitSaid(args: { text: string; images?: readonly SaidImage[] }): void
  moveTo(connection: ChannelConnection): void
  /** Re-emits the held connection, for a session that attached before subscribing. */
  announce(): void
  reload(reload: CloudReload): void
  ready(ready: ChannelReady): void
  fail(message: string): void
  failTransport(message: string): void
  acknowledgeInterrupt(): void
  pushRoster(roster: RosterWire): void
  /** Serve's own titling or another client renamed the thread; the frame lands on every client. */
  pushThreadRenamed(args: { threadId: ThreadId; title: string }): void
  pushThreadModelChanged(args: { threadId: ThreadId; model: ThreadModel }): void
  endTurn(outcome: TurnOutcome): void
  readonly closed: boolean
  readonly runs: number
  readonly sent: readonly {
    text: string
    images?: readonly SaidImage[]
    context?: readonly EventDraft[]
  }[]
  readonly requests: readonly { op: EClientRequest; params: unknown }[]
  readonly woken: readonly { url: string; token: string }[]
  readonly reconnects: number
}

const wireThreadOf = (thread: ThreadSummary): Record<string, unknown> => ({
  id: thread.id,
  head: thread.head,
  createdAt: thread.createdAt,
  updatedAt: thread.updatedAt,
  workspace: thread.workspace,
  repo: thread.repo,
  ...(thread.title === undefined ? {} : { title: thread.title }),
  ...(thread.model === undefined ? {} : { model: thread.model }),
  ...(thread.executionLocation === undefined
    ? {}
    : { executionLocation: thread.executionLocation }),
})

export function fakeCloudChannel(
  args: {
    threadId?: ThreadId
    log?: FakeEventLog | undefined
    threads?: FakeThreadStore | undefined
    /** The bridge's attach seeds Open, since a real channel has answered its Hello by then. */
    connection?: ChannelConnection | undefined
  } = {},
): FakeCloudChannel {
  const connections = new Set<(connection: ChannelConnection) => void>()
  const reloads = new Set<(reload: CloudReload) => void>()
  const readies = new Set<(ready: ChannelReady) => void>()
  const failures = new Set<(failure: { message: string }) => void>()
  const serverErrors = new Set<(failure: { message: string }) => void>()
  const interruptAcks = new Set<(ack: InterruptAck) => void>()
  const rosters = new Set<(roster: RosterWire) => void>()
  const threadRenames = new Set<(renamed: { threadId: ThreadId; title: string }) => void>()
  const threadModelChanges = new Set<
    (changed: { threadId: ThreadId; model: ThreadModel }) => void
  >()
  const turnEndings = new Set<(outcome: TurnOutcome) => void>()
  const woken: { url: string; token: string }[] = []
  const requests: { op: EClientRequest; params: unknown }[] = []
  const sent: {
    text: string
    images?: readonly SaidImage[]
    context?: readonly EventDraft[]
  }[] = []

  let held: ChannelConnection =
    args.connection ?? { state: EChannelConnection.Connecting, detail: null }
  let heldRoster: RosterWire = { shells: [], agents: [], services: [] }
  let closed = false
  let runs = 0
  let reconnected = 0
  const channelThreadId = args.threadId ?? CLOUD_THREAD

  return {
    threadId: channelThreadId,
    commitSaid: ({ text, images }) => {
      const threadId = channelThreadId
      void args.log?.append({
        threadId,
        runId: toRunId(`serve-${threadId}`),
        drafts: [{ type: 'user-said', text, ...(images === undefined ? {} : { images }) }],
      })
    },
    subscribe: () => () => undefined,
    snapshot: () => [],
    publisherFor: () => {
      throw new Error('a cloud channel never publishes from the client')
    },
    send: (said) => {
      sent.push({
        text: said.text,
        ...(said.images === undefined ? {} : { images: said.images }),
        ...(said.context === undefined ? {} : { context: said.context }),
      })
      // Serve commits a Send frame into its own log before the turn runs — mirror that here so a
      // spec reading the remote log sees the said, exactly as production does. Deferred a tick and
      // error-tolerant: the real commit is async against the socket, and a spec that holds the log
      // append open to watch the in-flight "sending" row needs the frame recorded first, with the
      // rejection — not the append — the thing that downgrades it.
      const threadId = channelThreadId
      queueMicrotask(() => {
        void args.log
          ?.append({
            threadId,
            runId: toRunId(`serve-${threadId}`),
            drafts: [
              ...(said.context ?? []),
              {
                type: 'user-said',
                text: said.text,
                ...(said.images === undefined ? {} : { images: said.images }),
              },
            ],
          })
          .catch(() => undefined)
      })
    },
    run: () => {
      runs += 1
    },
    interrupt: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    request: async (given) => {
      requests.push({ op: given.op, params: given.params })
      if (given.op === EClientRequest.ListRoster) return heldRoster
      if (given.op === EClientRequest.PublishWorkspace) return null
      if (given.op === EClientRequest.Rewind) {
        // Serve truncates its own durable log inside the same apply that kills the cuts, so the
        // fake does the same against the log it was handed.
        const params = given.params as { threadId: ThreadId; toSeq?: number | undefined }
        if (params.toSeq !== undefined) {
          args.log?.truncate({ threadId: params.threadId, toSeq: params.toSeq })
        }
        return { applied: 0 }
      }
      if (given.op === EClientRequest.ReadThread) {
        const params = given.params as { threadId: ThreadId }
        const thread = await args.threads?.find({ threadId: params.threadId })
        return { thread: thread === undefined ? null : wireThreadOf(thread) }
      }
      if (given.op === EClientRequest.ReadThreads) {
        const held = (await args.threads?.list({ project: '' })) ?? []
        return { threads: held.map(wireThreadOf) }
      }
      if (given.op === EClientRequest.RenameThread) {
        const params = given.params as { threadId: ThreadId; title: string }
        await args.threads?.rename(params)
        queueMicrotask(() => {
          for (const listener of [...threadRenames]) listener(params)
        })
        return undefined
      }
      if (given.op === EClientRequest.SetThreadModel) {
        const params = given.params as { threadId: ThreadId; model: ThreadModel }
        await args.threads?.chooseModel(params)
        queueMicrotask(() => {
          for (const listener of [...threadModelChanges]) listener(params)
        })
        return undefined
      }
      return { applied: 0 }
    },
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
    onReady: (listener) => {
      readies.add(listener)
      return () => {
        readies.delete(listener)
      }
    },
    onTurnEnded: (listener) => {
      turnEndings.add(listener)
      return () => {
        turnEndings.delete(listener)
      }
    },
    onError: (listener) => {
      failures.add(listener)
      return () => {
        failures.delete(listener)
      }
    },
    onServerError: (listener) => {
      serverErrors.add(listener)
      return () => {
        serverErrors.delete(listener)
      }
    },
    onInterruptAck: (listener) => {
      interruptAcks.add(listener)
      return () => {
        interruptAcks.delete(listener)
      }
    },
    onRoster: (listener) => {
      rosters.add(listener)
      return () => {
        rosters.delete(listener)
      }
    },
    onThreadRenamed: (listener) => {
      threadRenames.add(listener)
      return () => {
        threadRenames.delete(listener)
      }
    },
    onThreadModelChanged: (listener) => {
      threadModelChanges.add(listener)
      return () => {
        threadModelChanges.delete(listener)
      }
    },
    wake: ({ url, token }) => {
      woken.push({ url, token })
    },
    reconnect: () => {
      reconnected += 1
    },
    close: () => {
      closed = true
    },

    get closed() {
      return closed
    },

    get runs() {
      return runs
    },

    get sent() {
      return sent
    },

    get woken() {
      return woken
    },

    get reconnects() {
      return reconnected
    },

    moveTo(connection) {
      held = connection
      for (const listener of [...connections]) listener(connection)
    },
    announce() {
      for (const listener of [...connections]) listener(held)
    },
    reload(reload) {
      for (const listener of [...reloads]) listener(reload)
    },
    requests,
    ready(ready) {
      for (const listener of [...readies]) listener(ready)
    },
    fail(message) {
      for (const listener of [...failures]) listener({ message })
      for (const listener of [...serverErrors]) listener({ message })
    },
    failTransport(message) {
      for (const listener of [...failures]) listener({ message })
    },
    acknowledgeInterrupt() {
      for (const listener of [...interruptAcks]) listener({ turnInFlight: true })
    },
    pushRoster(roster: RosterWire) {
      heldRoster = roster
      for (const listener of [...rosters]) listener(roster)
    },
    pushThreadRenamed({ threadId, title }) {
      for (const listener of [...threadRenames]) listener({ threadId, title })
    },
    pushThreadModelChanged({ threadId, model }) {
      for (const listener of [...threadModelChanges]) listener({ threadId, model })
    },
    endTurn(outcome) {
      for (const listener of [...turnEndings]) listener(outcome)
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

  findNamed(args: Parameters<ThreadStorePort['findNamed']>[0]) {
    return this.inner.findNamed(args)
  }

  rename(args: Parameters<ThreadStorePort['rename']>[0]) {
    return this.inner.rename(args)
  }

  override onRename(listener: Parameters<ThreadStorePort['onRename']>[0]) {
    return this.inner.onRename(listener)
  }

  override onModelChosen(listener: Parameters<ThreadStorePort['onModelChosen']>[0]) {
    return this.inner.onModelChosen(listener)
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
  readonly created: readonly {
    threadId: ThreadId
    workspace: LiftedWorkspace | null
    gpgKey?: string | undefined
  }[]
  readonly contextPuts: readonly { threadId: ThreadId; archive: Buffer }[]
  readonly attached: readonly { threadId: ThreadId; url: string; token: string }[]
  readonly destroyed: readonly ThreadId[]
  readonly channel: FakeCloudChannel
  readonly trail: readonly string[]
  /** Wire the local transcript a lift ships up; the mount fixture sets it once the app exists. */
  sourceStores(args: { log: FakeEventLog; threads: FakeThreadStore; workspace: string }): void
}

const RUNNING: CloudSandbox = {
  url: 'https://sandbox.example/thread',
  token: 'sandbox-token',
  state: ECloudSandboxState.Running,
  created: true,
}

export function fakeBridge(
  args: {
    sandbox?: CloudSandbox
    createFails?: unknown
    putContextFails?: unknown
    destroyFails?: unknown
    status?: CloudSandboxStatus | undefined
    threadStore?: FakeThreadStore
    /** The local transcript a lift ships up; the fake's stand-in for the sandbox untarring it. */
    sourceLog?: FakeEventLog | undefined
    sourceThreads?: FakeThreadStore | undefined
  } = {},
): FakeBridge {
  const log = fakeEventLog()
  const threads = args.threadStore ?? fakeThreadStore({ log })
  const ledger = fakeLedger()
  let channel: FakeCloudChannel | null = null
  const created: {
    threadId: ThreadId
    workspace: LiftedWorkspace | null
    gpgKey?: string | undefined
  }[] = []
  const contextPuts: { threadId: ThreadId; archive: Buffer }[] = []
  const attached: { threadId: ThreadId; url: string; token: string }[] = []
  const destroyed: ThreadId[] = []
  const trail: string[] = []

  const watchedThreads = new WatchedThreadStore({ inner: threads, trail })

  let sourceLog = args.sourceLog
  let sourceThreads = args.sourceThreads
  let sourceWorkspace: string | null = null

  /**
   * The real serve boots with the transcript the lift uploaded and untars it into its local
   * stores, so the conversation reads answer with its events and thread row. The fake has no tar,
   * so it seeds the same end state synchronously — attach hands the stores back before the open
   * reads them, so the seeding cannot await.
   */
  const materialize = (threadId: ThreadId): void => {
    // A lift ships the local transcript up; a wake reattaches to one the sandbox already serves.
    const events = log.peek({ threadId }).length > 0 ? log.peek({ threadId }) : sourceLog?.peek({ threadId }) ?? []
    const sourceRow = sourceThreads?.peekRow({ threadId })
    if (events.length === 0 && sourceRow === undefined) return
    if (threads.peekRow({ threadId }) !== undefined) return

    threads.seedThread({
      id: threadId,
      head: events.at(-1)?.seq ?? 0,
      createdAt: events[0]?.at ?? '',
      updatedAt: events.at(-1)?.at ?? '',
      workspace: sourceRow?.workspace ?? sourceWorkspace,
      repo: sourceRow?.repo ?? null,
      ...(sourceRow?.title === undefined ? {} : { title: sourceRow.title }),
      ...(sourceRow?.executionLocation === undefined
        ? {}
        : { executionLocation: sourceRow.executionLocation }),
    })
    if (events.length > 0) log.seed({ threadId, events })
  }

  return {
    log,
    threads,
    ledger,
    created,
    contextPuts,
    attached,
    destroyed,
    get channel() {
      if (channel === null) throw new Error('nothing has attached yet')
      return channel
    },
    trail,
    sourceStores: ({ log: source, threads: sourceThreadStore, workspace }) => {
      sourceLog = source
      sourceThreads = sourceThreadStore
      sourceWorkspace = workspace
    },
    sandboxes: {
      create: async ({ threadId, workspace, gpgKey, captureContext }) => {
        const sandbox = args.sandbox ?? RUNNING
        // The real create captures and puts the archive onto the row before booting a fresh
        // sandbox, so the trail records it ahead of the boot; a resumed sandbox already carries
        // its context and never captures. The caller's thunk owns failure semantics, so the fake
        // only records the put — the thunk decides whether a put failure throws.
        if (captureContext !== undefined && sandbox.created) {
          await captureContext(async (archive) => {
            trail.push('put-context')
            contextPuts.push({ threadId, archive: Buffer.from(archive) })
            if (args.putContextFails !== undefined) throw args.putContextFails
          })
        }
        trail.push('sandbox')
        created.push({
          threadId,
          workspace,
          ...(gpgKey === undefined ? {} : { gpgKey }),
        })
        if (args.createFails !== undefined) throw args.createFails
        return sandbox
      },
      putContext: async ({ threadId, archive }) => {
        trail.push('put-context')
        contextPuts.push({ threadId, archive: Buffer.from(archive) })
        if (args.putContextFails !== undefined) throw args.putContextFails
      },
      putTranscript: async ({ threadId }) => {
        trail.push('put-transcript')
        materialize(threadId)
      },
      confirmLanded: async () => ({ landed: true }),
      find: async () => args.status,
      destroy: async ({ threadId }) => {
        trail.push('destroy')
        destroyed.push(threadId)
        if (args.destroyFails !== undefined) throw args.destroyFails
      },
    },
    attach: ({ threadId, url, token }) => {
      trail.push('attach')
      attached.push({ threadId, url, token })
      materialize(threadId)
      channel = fakeCloudChannel({
        threadId,
        log,
        threads,
        connection: { state: EChannelConnection.Open, detail: null },
      })
      const remoteThreads = new RemoteThreadStore({ channel })
      const attachedThreads = new Proxy(watchedThreads, {
        get: (target, property, receiver) => {
          if (
            property === 'onRename' ||
            property === 'onModelChosen' ||
            property === 'rename' ||
            property === 'chooseModel'
          ) {
            const remote = remoteThreads as unknown as Record<PropertyKey, unknown>
            const held = Reflect.get(remote, property, receiver)
            return typeof held === 'function' ? held.bind(remoteThreads) : held
          }
          const held = Reflect.get(target, property, receiver)
          return typeof held === 'function' ? held.bind(target) : held
        },
      })
      return { channel, stores: { log, threads: attachedThreads, ledger } }
    },
  }
}
