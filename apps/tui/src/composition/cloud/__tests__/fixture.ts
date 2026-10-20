import { createHash } from 'node:crypto'
import { stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  toRunId,
  toThreadId,
  type EventDraft,
  type SaidImage,
  type ThreadId,
} from '@dltech/atlas-core'
import type { PendingEntryWire, RosterWire, RuntimeCheckpoint } from '@dltech/atlas-wire'
import {
  EClientRequest,
  EConnectionView,
  ETurnStatus,
  RemoteThreadStore,
  ThreadStorePort,
  type ChannelConnection,
  type ChannelListener,
  type ChannelReady,
  type ChannelSignal,
  type InterruptAck,
  type ThreadModel,
  type ThreadSummary,
  type TurnOutcome,
  type PendingSaid,
} from '@dltech/atlas-harness'
import type { RotationStateWire } from '@dltech/atlas-wire'

import {
  fakeEventLog,
  fakeLedger,
  fakeThreadStore,
  SPEC_SHARD,
  type FakeEventLog,
  type FakeLedger,
  type FakeThreadStore,
} from '../../__tests__/fake-backend'
import { identityReplyOf, FakeSessionDisk } from '../../__tests__/fake-session-disk'
import {
  ECloudSandboxState,
  EResizeApplies,
  type CloudBridge,
  type CloudChannel,
  type CloudReload,
  type CloudSandbox,
  type CloudSandboxStatus,
  type WorkspaceSpec,
} from '@dltech/atlas-harness'

export const CLOUD_THREAD = toThreadId(`cloud-thread-${SPEC_SHARD}`)

export const CLEAN_WORKSPACE: WorkspaceSpec = {
  remoteUrl: 'git@github.com:comp-ai/atlas.git',
}

export type FakeCloudChannel = CloudChannel & {
  /** What serve does with a send frame: the said lands in the remote log before the turn ends. */
  commitSaid(args: { text: string; images?: readonly SaidImage[] }): void
  /** Serve answers attach-time transcript reads only once its boot has settled. */
  deferUntilBooted(boot: Promise<void>): void
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
  /** Serve broadcasts a rotation stage; the fake re-emits it to channel subscribers. */
  pushRotation(rotation: RotationStateWire): void
  endTurn(outcome: TurnOutcome): void
  onCheckpoint(listener: (checkpoint: RuntimeCheckpoint) => void): () => void
  pushCheckpoint(checkpoint: RuntimeCheckpoint): void
  /** Serve broadcasts its queue as pending-changed signals; the fake holds the latest snapshot. */
  pushPending(entries: readonly PendingEntryWire[]): void
  pendingEntries(): readonly PendingEntryWire[]
  onPendingChanged(listener: (entries: readonly PendingEntryWire[]) => void): () => void
  /** Serve answers a take-back by dequeuing its newest queued said; the fake holds one to hand back. */
  holdTakeBack(taken: PendingSaid | null): void
  readonly closed: boolean
  readonly runs: number
  readonly resumed: number
  readonly sent: readonly {
    text: string
    images?: readonly SaidImage[]
    context?: readonly EventDraft[]
  }[]
  readonly requests: readonly { op: EClientRequest; params: unknown }[]
  readonly woken: readonly { url: string; token: string }[]
  /** Checkpoints the open handed the channel from the sandbox status read. */
  readonly observed: readonly RuntimeCheckpoint[]
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
    /** Called when `wake` hands the channel its url and token — the fake's stand-in for dialling. */
    onDial?: ((dial: { url: string; token: string }) => void) | undefined
    log?: FakeEventLog | undefined
    threads?: FakeThreadStore | undefined
    /** The on-disk mirror of the remote session the fake serve writes against. */
    disk?: FakeSessionDisk | undefined
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
  const signalListeners = new Set<ChannelListener>()
  let resumes = 0
  const checkpoints = new Set<(checkpoint: RuntimeCheckpoint) => void>()
  const pendingChanges = new Set<(entries: readonly PendingEntryWire[]) => void>()
  let heldPending: readonly PendingEntryWire[] = []
  let heldTakeBack: PendingSaid | null = null
  const woken: { url: string; token: string }[] = []
  const observed: RuntimeCheckpoint[] = []
  const requests: { op: EClientRequest; params: unknown }[] = []
  const sent: {
    text: string
    images?: readonly SaidImage[]
    context?: readonly EventDraft[]
  }[] = []

  let booted: Promise<void> = Promise.resolve()

  let held: ChannelConnection =
    args.connection ?? { state: EConnectionView.Waking, detail: null }
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
    deferUntilBooted(boot) {
      booted = boot
    },

    subscribe: ({ listener }: { threadId: ThreadId; listener: ChannelListener }) => {
      signalListeners.add(listener)
      return () => {
        signalListeners.delete(listener)
      }
    },
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
    pause: () => {
      const runId = toRunId(`serve-${channelThreadId}`)
      queueMicrotask(() => {
        for (const listener of [...turnEndings]) listener({ status: ETurnStatus.RelocationPaused, runId })
      })
    },
    resume: () => {
      resumes += 1
    },
    syncSettings: () => undefined,
    request: async (given) => {
      requests.push({ op: given.op, params: given.params })
      if (given.op === EClientRequest.ListRoster) return heldRoster
      if (given.op === EClientRequest.Rotate) return { type: 'started' }
      if (given.op === EClientRequest.TakeBackPending) {
        const taken = heldTakeBack
        heldTakeBack = null
        if (taken !== null) {
          heldPending = heldPending.slice(0, -1)
          queueMicrotask(() => {
            for (const listener of [...pendingChanges]) listener(heldPending)
          })
        }
        return { taken }
      }
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
      if (given.op === EClientRequest.ReadTranscriptIdentity) {
        await booted
      }
      if (given.op === EClientRequest.ReadTranscriptIdentity) {
        const params = given.params as { threadId: ThreadId; upTo?: number | undefined }
        const events = args.log?.peek({ threadId: params.threadId }) ?? []
        const held =
          params.upTo === undefined
            ? events
            : events.filter((event) => event.seq <= (params.upTo ?? 0))
        return identityReplyOf(held)
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
    onPrStates: () => () => undefined,
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
      args.onDial?.({ url, token })
    },
    beginWake: () => {
      held = { state: EConnectionView.Waking, detail: null }
      for (const listener of [...connections]) listener(held)
    },
    beginRotation: () => {
      held = { state: EConnectionView.Updating, detail: 'updating the pod' }
      for (const listener of [...connections]) listener(held)
    },
    failWake: ({ reason }) => {
      held = { state: EConnectionView.Disconnected, detail: reason }
      for (const listener of [...connections]) listener(held)
    },
    observeCheckpoint: (checkpoint) => {
      observed.push(checkpoint)
    },
    unackedSendCount: () => 0,
    attachment: () => undefined,
    reconnect: () => {
      reconnected += 1
    },
    close: () => {
      closed = true
    },

    get closed() {
      return closed
    },

    get resumed() {
      return resumes
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

    get observed() {
      return observed
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
    pushRotation(rotation) {
      const signal: ChannelSignal = { type: 'rotation-changed', rotation }
      for (const listener of [...signalListeners]) listener(signal)
    },
    pushPending(entries) {
      heldPending = entries
      for (const listener of [...pendingChanges]) listener(entries)
    },
    pendingEntries: () => heldPending,
    onPendingChanged: (listener) => {
      pendingChanges.add(listener)
      return () => {
        pendingChanges.delete(listener)
      }
    },
    holdTakeBack(taken) {
      heldTakeBack = taken
    },
    endTurn(outcome) {
      for (const listener of [...turnEndings]) listener(outcome)
    },
    onCheckpoint: (listener: (checkpoint: RuntimeCheckpoint) => void) => {
      checkpoints.add(listener)
      return () => {
        checkpoints.delete(listener)
      }
    },
    pushCheckpoint(checkpoint: RuntimeCheckpoint) {
      for (const listener of [...checkpoints]) listener(checkpoint)
    },
  }
}

/**
 * The order a birth does things in is the contract, so the two writes that move a thread are named
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

  override chooseRunner(args: Parameters<ThreadStorePort['chooseRunner']>[0]) {
    return this.inner.chooseRunner(args)
  }

  override chooseProject(args: Parameters<ThreadStorePort['chooseProject']>[0]) {
    return this.inner.chooseProject(args)
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
    projectId: string | null
  }[]
  readonly contextPuts: readonly { threadId: ThreadId; archive: Buffer }[]
  readonly attached: readonly { threadId: ThreadId; url: string; token: string }[]
  /** Channels handed out without a url or token: parked, no socket, until `wake` dials. */
  readonly parkedAttaches: readonly ThreadId[]
  readonly destroyed: readonly ThreadId[]
  readonly channel: FakeCloudChannel
  readonly trail: readonly string[]
  /** Wire the local transcript a birth ships up; the mount fixture sets it once the app exists. */
  sourceStores(args: {
    log: FakeEventLog
    threads: FakeThreadStore
    workspace: string
    disk?: FakeSessionDisk | undefined
  }): void
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
    /** Lets a spec move the sandbox row after the bridge exists — the control plane's answer. */
    statusRef?: { current: CloudSandboxStatus | undefined } | undefined
    checkpoint?: RuntimeCheckpoint | undefined
    threadStore?: FakeThreadStore
    /** The local transcript a birth ships up; the fake's stand-in for the sandbox receiving it. */
    sourceLog?: FakeEventLog | undefined
    sourceThreads?: FakeThreadStore | undefined
    sourceDisk?: FakeSessionDisk | undefined
  } = {},
): FakeBridge {
  // The fake serve's session directory: every remote write lands here, the way
  // the sandbox actually holds it.
  const disk = new FakeSessionDisk(join(tmpdir(), `atlas-fake-cloud-${SPEC_SHARD}-${Math.random().toString(36).slice(2)}`))
  const log = fakeEventLog([], { disk })
  const threads = args.threadStore ?? fakeThreadStore({ log, disk })
  const ledger = fakeLedger()
  let channel: FakeCloudChannel | null = null
  const created: {
    threadId: ThreadId
    projectId: string | null
  }[] = []
  const contextPuts: { threadId: ThreadId; archive: Buffer }[] = []
  const attached: { threadId: ThreadId; url: string; token: string }[] = []
  const parkedAttaches: ThreadId[] = []
  const destroyed: ThreadId[] = []
  const trail: string[] = []

  const watchedThreads = new WatchedThreadStore({ inner: threads, trail })

  let sourceLog = args.sourceLog
  let sourceThreads = args.sourceThreads
  let sourceWorkspace: string | null = null
  let sourceDisk = args.sourceDisk

  /**
   * A wake reattaches to a transcript the sandbox already serves: the fake's stores were seeded
   * by the spec directly, so the thread row mirrors them synchronously. A birth's transcript lands
   * through the staged archive instead.
   */
  const materialize = (threadId: ThreadId): void => {
    const events =
      log.peek({ threadId }).length > 0
        ? log.peek({ threadId })
        : (sourceLog?.peek({ threadId }) ?? [])
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
    parkedAttaches,
    destroyed,
    get channel() {
      if (channel === null) throw new Error('nothing has attached yet')
      return channel
    },
    trail,
    sourceStores: ({ log: source, threads: sourceThreadStore, workspace, disk }) => {
      sourceLog = source
      sourceThreads = sourceThreadStore
      sourceWorkspace = workspace
      sourceDisk = disk
    },
    sandboxes: {
      create: async ({ threadId, projectId, captureContext, onRotationStarted }) => {
        const sandbox = args.sandbox ?? RUNNING
        if (sandbox.rotatedProtocol !== undefined || sandbox.rotatedFrom !== undefined)
          onRotationStarted?.()
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
          projectId,
        })
        if (args.createFails !== undefined) throw args.createFails
        return sandbox
      },
      find: async () => {
        const status = args.statusRef?.current ?? args.status
        if (status === undefined) return undefined
        if (args.checkpoint === undefined) return status
        return { ...status, checkpoint: args.checkpoint }
      },
      readResources: async () => ({}),
      updateResources: async () => ({ appliesAt: EResizeApplies.Live }),
      destroy: async ({ threadId }) => {
        trail.push('destroy')
        destroyed.push(threadId)
        if (args.destroyFails !== undefined) throw args.destroyFails
      },
    },
    attach: ({ threadId, url, token }) => {
      const dialled = url !== undefined && token !== undefined
      if (dialled) {
        trail.push('attach')
        attached.push({ threadId, url, token })
      } else {
        parkedAttaches.push(threadId)
      }
      materialize(threadId)
      const opened = fakeCloudChannel({
        threadId,
        log,
        threads,
        disk,
        connection: dialled
          ? { state: EConnectionView.Connected, detail: null }
          : { state: EConnectionView.Parked, detail: null },
        onDial: dialled
          ? undefined
          : (dial) => {
              trail.push('attach')
              attached.push({ threadId, ...dial })
              opened.reload({ sinceEventSeq: 0 })
              opened.moveTo({ state: EConnectionView.Connected, detail: null })
            },
      })
      channel = opened
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
