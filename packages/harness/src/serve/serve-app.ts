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
}

export type ServeCompose = (args: ServeComposeArgs) => Promise<ServeApp>
