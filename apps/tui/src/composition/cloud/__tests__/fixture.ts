import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'

import {
  EExecutionLocation,
  toRunId,
  toThreadId,
  type EventDraft,
  type SaidImage,
  type ThreadId,
} from '@dltech/atlas-core'
import { restoreTranscriptParamsSchema, type PendingEntryWire, type RosterWire, type RuntimeCheckpoint } from '@dltech/atlas-wire'
import {
  buildSessionArchive,
  EChannelConnection,
  EClientRequest,
  ETurnStatus,
  extractSessionArchive,
  parseEventLines,
  RemoteThreadStore,
  sessionDirectory,
  ThreadStorePort,
  type ChannelConnection,
  type ChannelReady,
  type InterruptAck,
  type ThreadModel,
  type ThreadSummary,
  type TurnOutcome,
  type PendingSaid,
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
import { identityReplyOf, FakeSessionDisk } from '../../__tests__/fake-session-disk'
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
  /** Serve untars the lift's upload into its session directory before it answers attach reads. */
  loadTranscriptArchive(archive: Uint8Array): Promise<void>
  /** Serve answers attach-time transcript reads only once its boot untar has landed. */
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
    /** The on-disk mirror of the remote session, for the descend's archive read. */
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
  let resumes = 0
  const checkpoints = new Set<(checkpoint: RuntimeCheckpoint) => void>()
  const pendingChanges = new Set<(entries: readonly PendingEntryWire[]) => void>()
  let heldPending: readonly PendingEntryWire[] = []
  let heldTakeBack: PendingSaid | null = null
  const woken: { url: string; token: string }[] = []
  const requests: { op: EClientRequest; params: unknown }[] = []
  const sent: {
    text: string
    images?: readonly SaidImage[]
    context?: readonly EventDraft[]
  }[] = []

  let transcriptRestored = false
  let booted: Promise<void> = Promise.resolve()

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
    deferUntilBooted(boot) {
      booted = boot
    },
    loadTranscriptArchive: (archive) => {
      const untar = (async () => {
        const scratch = await mkdtemp(join(tmpdir(), 'atlas-fake-serve-'))
        try {
        const sessionDir = join(scratch, 'session')
        await extractSessionArchive({ archive, sessionDir })
        const directory = join(sessionDir, 'threads')
        const names = await readdir(directory, { recursive: true }).catch(() => [] as string[])
        for (const name of names) {
          if (!name.endsWith('.events.jsonl')) continue
          const threadId = toThreadId(name.slice(0, -'.events.jsonl'.length).split(sep).join('/'))
          const text = await readFile(join(directory, name), 'utf8')
          args.log?.seed({
            threadId,
            events: parseEventLines({ text, threadId }).events,
          })
        }
          // Serve keeps the extracted directory as the session it serves from, so the descend's
          // archive read tars that directory back up — not the bytes that arrived.
          if (args.disk !== undefined) {
            await args.disk.replaceSessionDir({ threadId: channelThreadId, fromDir: sessionDir })
          }
          transcriptRestored = true
        } finally {
          await rm(scratch, { recursive: true, force: true }).catch(() => undefined)
        }
      })()
      booted = untar
      return untar
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
    pause: () => {
      const runId = toRunId(`serve-${channelThreadId}`)
      queueMicrotask(() => {
        for (const listener of [...turnEndings]) listener({ status: ETurnStatus.RelocationPaused, runId })
      })
    },
    resume: () => {
      resumes += 1
    },
    request: async (given) => {
      requests.push({ op: given.op, params: given.params })
      if (given.op === EClientRequest.ListRoster) return heldRoster
      if (given.op === EClientRequest.PublishWorkspace) return null
      if (given.op === EClientRequest.PrepareWorkspaceArchive) return { path: ARCHIVE_EXPORT_PATH, manifest: ARCHIVE_MANIFEST }
      if (given.op === EClientRequest.ActivateSession) return { activated: true }
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
      if (
        given.op === EClientRequest.RestoreTranscript ||
        given.op === EClientRequest.ReadTranscriptIdentity ||
        given.op === EClientRequest.ReadSessionArchive
      ) {
        // Serve has untarred the staged archive by the time it serves requests.
        await booted
      }
      if (given.op === EClientRequest.RestoreTranscript) {
        // Mirror the serve's restore: pin the lift's location-changed marker on the sandbox log,
        // unless the log already ends at a location-changed with the same `to`.
        const params = restoreTranscriptParamsSchema.safeParse(given.params ?? {})
        const marker = params.success ? params.data.locationChanged : undefined
        if (marker !== undefined && args.log !== undefined) {
          const last = args.log.peek({ threadId: channelThreadId }).at(-1)
          if (!(last?.type === 'location-changed' && last.to === marker.to)) {
            await args.log.append({
              threadId: channelThreadId,
              runId: toRunId(`serve-${channelThreadId}`),
              drafts: [
                {
                  type: 'location-changed',
                  from: marker.from as EExecutionLocation,
                  to: marker.to as EExecutionLocation,
                  ...(marker.cwd === undefined ? {} : { cwd: marker.cwd }),
                  ...(marker.remoteUrl === undefined ? {} : { remoteUrl: marker.remoteUrl }),
                  ...(marker.branch === undefined ? {} : { branch: marker.branch }),
                },
              ],
            })
          }
        }
        return { restored: transcriptRestored }
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
      if (given.op === EClientRequest.ReadSessionArchive) {
        const archive =
          args.disk === undefined
            ? undefined
            : await buildSessionArchive({
                sessionDir: sessionDirectory({
                  home: args.disk.home(),
                  sessionId: channelThreadId,
                }),
              })
        return { archive: archive === undefined ? '' : Buffer.from(archive).toString('base64') }
      }
      if (given.op === EClientRequest.ReadMemoryArchive) {
        return { archive: '' }
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
    beginWake: () => {
      held = { state: EChannelConnection.Waking, detail: null }
      for (const listener of [...connections]) listener(held)
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

const ARCHIVE_EXPORT_PATH = '/tmp/atlas-workspace-export-x/workspace.tar.gz'

const ARCHIVE_MANIFEST = {
  version: 1,
  repository: { sourcePath: '/atlas/workspace', originPath: '/work' },
  activeId: 'main',
  activeRelativePath: '',
  trees: [
    {
      id: 'main',
      name: 'main',
      sourcePath: '/atlas/workspace',
      originPath: '/work',
      branch: 'main',
      head: null,
      baseline: null,
      fingerprint: 'fake',
      isMain: true,
    },
  ],
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
    /** The local transcript a lift ships up; the fake's stand-in for the sandbox untarring it. */
    sourceLog?: FakeEventLog | undefined
    sourceThreads?: FakeThreadStore | undefined
    sourceDisk?: FakeSessionDisk | undefined
  } = {},
): FakeBridge {
  // The fake serve's session directory: every remote write lands here so the descend tars up
  // what the sandbox actually holds, the way serveSessionArchive does.
  const disk = new FakeSessionDisk(join(tmpdir(), `atlas-fake-cloud-${SPEC_SHARD}-${Math.random().toString(36).slice(2)}`))
  const log = fakeEventLog([], { disk })
  const threads = args.threadStore ?? fakeThreadStore({ log, disk })
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
  let sourceDisk = args.sourceDisk
  let stagedTranscript: Uint8Array | undefined
  let transcriptShipped = false

  /**
   * The real create stages the uploaded archive next to the serve binary so the bootstrap untars
   * it into the session directory before launch; attach untars the staged bytes through the new
   * channel, so the transcript the plan restores and verifies is the one the lift shipped.
   */
  const stageTranscript = async (args: {
    threadId: ThreadId
    archive: Uint8Array
  }): Promise<void> => {
    stagedTranscript = args.archive
    transcriptShipped = true
    if (channel !== null) await channel.loadTranscriptArchive(args.archive)
  }

  /**
   * A wake reattaches to a transcript the sandbox already serves: the fake's stores were seeded
   * by the spec directly, so the thread row mirrors them synchronously. A lift's transcript lands
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
      create: async ({ threadId, workspace, gpgKey, transcript, captureContext, onRotationStarted }) => {
        const sandbox = args.sandbox ?? RUNNING
        if (sandbox.rotatedProtocol !== undefined) onRotationStarted?.()
        // The real create stages the transcript archive next to the serve binary before launch,
        // so the bootstrap untars it into the session directory the sandbox serves from.
        if (transcript !== undefined) await stageTranscript({ threadId, archive: transcript })
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
      putTranscript: async ({ threadId, archive }) => {
        trail.push('put-transcript')
        await stageTranscript({ threadId, archive })
        materialize(threadId)
      },
      confirmLanded: async () => ({ landed: transcriptShipped }),
      downloadWorkspace: async ({ destination }) => {
        await writeFile(destination, 'a fake workspace archive')
      },
      find: async () => {
        const status = args.statusRef?.current ?? args.status
        if (status === undefined) return undefined
        if (args.checkpoint === undefined) return status
        return { ...status, checkpoint: args.checkpoint }
      },
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
      const opened = fakeCloudChannel({
        threadId,
        log,
        threads,
        disk,
        connection: { state: EChannelConnection.Open, detail: null },
      })
      channel = opened
      // Serve has untarred the staged archive into its session directory by the time a client can
      // attach; the untar lands here, ahead of the plan's requests, which the channel gates on it.
      if (stagedTranscript !== undefined) {
        const archive = stagedTranscript
        stagedTranscript = undefined
        opened.deferUntilBooted(opened.loadTranscriptArchive(archive))
      }
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
