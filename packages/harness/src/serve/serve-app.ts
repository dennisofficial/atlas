import type {
  EnvironmentCapabilities,
  EventLogPort,
  IdPort,
  NoticePort,
  ThreadId,
  WorkspaceIdentity,
} from '@dltech/atlas-core'

import type { DeltaChannel } from '../channel/delta-channel'
import type { FileBrowser } from '../files/file-browser'
import type { TurnRunner } from '../loop/turn-runner.port'
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

/** The composed session as serve consumes it: everything a socket can reach and nothing else. */
export type ServeApp = {
  channel: DeltaChannel
  runner: Pick<TurnRunner, 'runTurn'>
  log: Pick<EventLogPort, 'append' | 'read'>
  threads: Pick<ThreadStorePort, 'find' | 'createWithFirstEvents'>
  ids: Pick<IdPort, 'nextRunId'>
  files: Pick<FileBrowser, 'list' | 'forget'>
  workspace: WorkspaceIdentity
  /** Resumes the served thread's transferred children — see adopt-children.ts for why it must. */
  adoptChildren: (args: { threadId: ThreadId }) => Promise<readonly ThreadId[]>
  whenChildrenSettled: (args: { threadId: ThreadId }) => Promise<void>
  /** Carries this sandbox's memory back to the control plane — see upload-memory.ts. */
  syncMemoryAfterTurn: () => Promise<void>
  /** Live counts behind the idle park; absent in fakes, where nothing runs. */
  runningShells?: (() => number) | undefined
  runningServices?: (() => number) | undefined
  /** Absent in a fake without registries: no endings means nothing to wake for. */
  wakeNotices?: ServeWakeNotices | undefined
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
