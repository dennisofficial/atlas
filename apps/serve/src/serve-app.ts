import type {
  EKilledBy,
  EventLogPort,
  IdPort,
  NoticePort,
  ThreadId,
  WorkspaceIdentity,
} from '@dltech/atlas-core'
import type { RosterWire } from '@dltech/atlas-wire'

import type { DeltaChannel, PlacementController } from '@dltech/atlas-harness'
import type { FileBrowser } from '@dltech/atlas-harness'
import type { MessageIntake } from '@dltech/atlas-harness'
import type { PendingQueues } from '@dltech/atlas-harness'
import type { TurnLedgerPort } from '@dltech/atlas-harness'
import type { TurnPolicy } from '@dltech/atlas-harness'
import type { TurnRunner } from '@dltech/atlas-harness'
import type { LostService, LostShell } from '@dltech/atlas-harness'
import type { ThreadStorePort } from '@dltech/atlas-harness'

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
 * The served thread's stepping children narrowed to what a descend pause needs: freeze each one at
 * the loop's seam and resolve only once every step has settled into that halt, so the session
 * archive that follows races no writer. Absent in fakes, where pausing the parent's own turn is
 * all there is.
 */
export type ServeFamily = {
  pauseChildren: (args: { threadId: ThreadId }) => Promise<void>
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

/**
 * The serve's reach into the running loop's model selection: the select that re-pins the
 * switchable model mid-session, and the effort the loop currently runs on. A serve composed
 * without it still records the pick to the transcript and broadcasts it — the live re-pin is the
 * part a fake cannot stand in for.
 */
export type ServeModelBridge = {
  effort: () => string
  select: (next: { ref: string; effort: string }) => void
}

/** The composed session as serve consumes it: everything a socket can reach and nothing else. */
export type ServeApp = {
  channel: DeltaChannel
  runner: Pick<TurnRunner, 'runTurn' | 'resume'>
  /** The between-turns rules the shared root composed — absent in fakes, which run no policy. */
  turnPolicy?: TurnPolicy | undefined
  log: Pick<EventLogPort, 'append' | 'read' | 'readOwn' | 'head' | 'refresh'>
  threads: Pick<
    ThreadStorePort,
    'find' | 'createWithFirstEvents' | 'spawned' | 'list' | 'rename' | 'chooseModel' | 'onRename' | 'onModelChosen' | 'writePlacement'
  >
  /** The live model the channel's set-thread-model op re-pins; absent in fakes. */
  modelBridge?: ServeModelBridge | undefined
  /** The on-disk turn spend, read by the transcript turn-feed op. Absent in fakes. */
  ledger?: Pick<TurnLedgerPort, 'forThread' | 'forThreadTree'> | undefined
  ids: Pick<IdPort, 'nextRunId'>
  files: Pick<FileBrowser, 'list' | 'forget'>
  workspace: WorkspaceIdentity
  pending?: PendingQueues | undefined
  /** The shared message intake driving this serve's idle wake; absent in fakes. */
  intake?: MessageIntake | undefined
  /** Resumes the served thread's transferred children — see adopt-children.ts for why it must. */
  adoptChildren: (args: { threadId: ThreadId }) => Promise<readonly ThreadId[]>
  /**
   * Settles the shells the last process lost — a start with no ending behind it gets a synthetic
   * unrecorded ending so the next open reads it off the transcript. Absent in a fake without a log.
   */
  recordLostShells?: ((args: { threadId: ThreadId }) => Promise<readonly LostShell[]>) | undefined
  recordLostServices?: ((args: { threadId: ThreadId }) => Promise<readonly LostService[]>) | undefined
  whenChildrenSettled: (args: { threadId: ThreadId }) => Promise<void>
  /** Tars the served session directory for the descend's transcript transfer; absent in fakes. */
  sessionArchive?: (() => Promise<Uint8Array | null>) | undefined
  /** Tars the sandbox's memory roots for the descend's memory transfer; absent in fakes. */
  memoryArchive?: (() => Promise<Uint8Array | null>) | undefined
  /**
   * The lift's late transcript restore: extracts the archive the client shipped to the drive and
   * refreshes the store so the read ops serve it. Absent in fakes, which refuse the op.
   */
  restoreTranscript?: (() => Promise<{ restored: boolean; failed: string | null }>) | undefined
  /** Live counts behind the idle park; absent in fakes, where nothing runs. */
  runningShells?: (() => number) | undefined
  runningServices?: (() => number) | undefined
  runningChildren?: (() => number) | undefined
  settlingWork?: (() => boolean) | undefined
  pendingInput?: (() => boolean) | undefined
  /** Absent in a fake without registries: no endings means nothing to wake for. */
  wakeNotices?: ServeWakeNotices | undefined
  /** Absent in a fake without registries: the client is answered an empty roster instead. */
  roster?: ServeRoster | undefined
  /** Absent in a fake without registries: a descend pause halts the parent's turn only. */
  family?: ServeFamily | undefined
  /** Absent in a fake without registries: a rewind apply is refused rather than dropped. */
  rewind?: ServeRewind | undefined
  /** The session's placement controller; serve hydrates it to cloud after transcript restore. */
  executionLocation?: PlacementController | undefined
  close: () => Promise<void>
}

export type ServeComposeArgs = {
  threadId: ThreadId
  cwd: string
  controlPlaneUrl: string
  token: string
  clientVersion: string
  env: Record<string, string | undefined>
  model: { ref: string; effort?: string | undefined } | undefined
  notice: NoticePort
  /** The Mac-side project directory, so memory this sandbox uploads is keyed by the right repo. */
  projectDirectory?: string | null | undefined
  /**
   * The repo's normalized origin identity (`github.com/org/repo`) from the workspace spec, so the
   * sandbox's project memory lands in the same identity-keyed directory the host uses. Null when
   * the repo has no host-named remote; undefined only against a control plane too old to say.
   */
  identity?: string | null | undefined
}

export type ServeCompose = (args: ServeComposeArgs) => Promise<ServeApp>
