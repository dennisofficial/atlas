import type { ThreadId } from '@dltech/atlas-core'

import type { DirectWorkspaceRestorer } from './direct-workspace'
import type { ApplyEnvironmentProfile } from './environment-profile'
import type { EnsureWorkspace } from './materialize-workspace'
import type { WorkspaceCapturer } from './prepare-workspace'
import type { ServeCompose } from './serve-app'
import type { LogWrite } from './serve-log'
import type { WorkspaceFiles } from './workspace-files'
import type { FetchTranscriptArchive } from './workspace-spec'

/** Everything the sandbox is told at creation falls back to its environment variable. */
export type ServeArgs = {
  threadId?: ThreadId | undefined
  port?: number | undefined
  token?: string | undefined
  controlPlaneUrl?: string | undefined
  cwd?: string | undefined
  model?: { ref: string; effort?: string | undefined } | undefined
  clientVersion?: string | undefined
  env?: Record<string, string | undefined> | undefined
  bufferSize?: number | undefined
  drainDeadlineMs?: number | undefined
  idleMinutes?: number | undefined
  idleTickMs?: number | undefined
  /** What an idle serve does after closing — injectable so a spec's process survives it. */
  exit?: ((code: number) => void) | undefined
  stopSandbox?: (() => Promise<void>) | undefined
  fetchFn?: typeof fetch | undefined
  write?: LogWrite | undefined
  compose?: ServeCompose | undefined
  ensureWorkspace?: EnsureWorkspace | undefined
  profile?: ApplyEnvironmentProfile | undefined
  contextFiles?: WorkspaceFiles | undefined
  fetchTranscriptArchive?: FetchTranscriptArchive | undefined
  restoreWorkspace?: DirectWorkspaceRestorer | undefined
  captureWorkspace?: WorkspaceCapturer | undefined
}

export type ServeHandle = {
  port: number
  close: (args?: { reason: string }) => Promise<void>
}
