import type {
  EKilledBy,
  EnvironmentCapabilities,
  EventLogPort,
  IdPort,
  NoticePort,
  ThreadId,
  WorkspaceIdentity,
} from '@dltech/atlas-core'
import type { RosterWire } from '@dltech/atlas-wire'

import type { DeltaChannel } from '../channel/delta-channel'
import type { FileBrowser } from '../files/file-browser'
import type { TurnLedgerPort } from '../ledger/turn-ledger.port'
import type { TurnPolicy } from '../loop/turn-policy'
import type { TurnRunner } from '../loop/turn-runner.port'
import type { LostShell } from '../shells/recovery'
import type { ThreadStorePort } from '../store/thread-store'

/**
 * The registries' notice queues narrowed to what the idle wake reads: whether the served thread has
 * notices pending, and a subscription that fires when that answer may have changed. Each member is
 * the thread-scoped pending count of one registry and the unsubscribe for its listener.
 */
export type ServeWakeNotices = {
  pendingShells: (args: { threadId: ThreadId }) => number
  pendingAgents: (args: { threadId: ThreadId }) => number
  pendingServices: (args: { threadId: ThreadId }) => number
  subscribe: (listener: () => void) => () => void
}

/**
 * The live registries narrowed to what the socket serves a watching client: a point-in-time
 * roster, and a subscription that fires when it changed. The socket broadcasts the new snapshot on
 * every fire — the registries already coalesce output chatter into throttled flushes, so a
 * snapshot per fire never outruns the structural change it carries.
 */
export type ServeRoster = {
  snapshot: () => RosterWire
  subscribe: (listener: () => void) => () => void
}

/**
 * The real registries narrowed to what a confirmed rewind destroys through. Removal kills what is
 * still running — the same `removeChildren`/`removeShells`/`removeServices` the host's rewind
 * calls, answered by the sandbox because its processes live here.
 */
export type ServeRewind = {
  target: {
    removeChildren(args: { threadId: ThreadId; agentIds: readonly ThreadId[] }): Promise<void>
    removeShells(args: { threadId: ThreadId; shellIds: readonly string[]; by: EKilledBy }): void
    removeServices(args: { serviceIds: readonly string[]; by: EKilledBy }): void
  }
  /**
   * The durable truncation, present because this serve's transcript is its own disk. Applied in
   * the same rewind apply that kills the cut processes; absent in fakes, which hold no log.
   */
  truncate?: ((args: { threadId: ThreadId; toSeq: number; cutAgents: readonly ThreadId[] }) => Promise<void>) | undefined
}

/** The composed session as serve consumes it: everything a socket can reach and nothing else. */
export type ServeApp = {
  channel: DeltaChannel
  runner: Pick<TurnRunner, 'runTurn'>
  /** The between-turns rules the shared root composed — absent in fakes, which run no policy. */
  turnPolicy?: TurnPolicy | undefined
  log: Pick<EventLogPort, 'append' | 'read' | 'readOwn' | 'head'>
  threads: Pick<ThreadStorePort, 'find' | 'createWithFirstEvents' | 'spawned' | 'list'>
  /** The on-disk turn spend, read by the transcript turn-feed op. Absent in fakes. */
  ledger?: Pick<TurnLedgerPort, 'forThread' | 'forThreadTree'> | undefined
  ids: Pick<IdPort, 'nextRunId'>
  files: Pick<FileBrowser, 'list' | 'forget'>
  workspace: WorkspaceIdentity
  /** Resumes the served thread's transferred children — see adopt-children.ts for why it must. */
  adoptChildren: (args: { threadId: ThreadId }) => Promise<readonly ThreadId[]>
  /**
   * Settles the shells the last process lost — a start with no ending behind it gets a synthetic
   * unrecorded ending so the next open reads it off the transcript. Absent in a fake without a log.
   */
  recordLostShells?: ((args: { threadId: ThreadId }) => Promise<readonly LostShell[]>) | undefined
  whenChildrenSettled: (args: { threadId: ThreadId }) => Promise<void>
  /** Tars the served session directory for the descend's transcript transfer; absent in fakes. */
  sessionArchive?: (() => Promise<Uint8Array | null>) | undefined
  /** Carries this sandbox's memory back to the control plane — see upload-memory.ts. */
  syncMemoryAfterTurn: () => Promise<void>
  /** Live counts behind the idle park; absent in fakes, where nothing runs. */
  runningShells?: (() => number) | undefined
  runningServices?: (() => number) | undefined
  /** Absent in a fake without registries: no endings means nothing to wake for. */
  wakeNotices?: ServeWakeNotices | undefined
  /** Absent in a fake without registries: the client is answered an empty roster instead. */
  roster?: ServeRoster | undefined
  /** Absent in a fake without registries: a rewind apply is refused rather than dropped. */
  rewind?: ServeRewind | undefined
  close: () => Promise<void>
}

export type ServeComposeArgs = {
  threadId: ThreadId
  cwd: string
  controlPlaneUrl: string
  token: string
  clientVersion: string
  env: Record<string, string | undefined>
  model: string | undefined
  notice: NoticePort
  /** The Mac-side project directory, so memory this sandbox uploads is keyed by the right repo. */
  projectDirectory?: string | null | undefined
  capabilities?: EnvironmentCapabilities | undefined
  /**
   * The repo's normalized origin identity (`github.com/org/repo`) from the workspace spec, so the
   * sandbox's project memory lands in the same identity-keyed directory the host uses. Null when
   * the repo has no host-named remote; undefined only against a control plane too old to say.
   */
  identity?: string | null | undefined
}

export type ServeCompose = (args: ServeComposeArgs) => Promise<ServeApp>
