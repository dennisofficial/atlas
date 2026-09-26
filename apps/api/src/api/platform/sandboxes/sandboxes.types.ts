export enum ESandboxState {
  Running = 'running',
  Parked = 'parked',
  Resuming = 'resuming',
}

export interface SandboxListEntryDto {
  threadId: string
  name: string
  driveName: string | null
  state: ESandboxState
  lastActivityAt: string
}

export interface SandboxStatusDto {
  threadId: string
  name: string
  region: string
  state: ESandboxState
  lastActivityAt: string
  contextPending: boolean
  url?: string
}

export interface SandboxAttachmentDto extends SandboxStatusDto {
  token: string
}

/**
 * The local workspace as the sandbox must reproduce it: a commit to check out and a unified diff
 * carrying everything not committed, so lifting a session never asks the operator to commit first.
 */
export interface SandboxWorkspaceSpec {
  remoteUrl: string | null
  branch: string | null
  commit: string | null
  patch: string
  /** The Mac-side project directory of the lifted thread, absent for clients that predate it. */
  projectDirectory?: string | null
  /** The operator's git identity, absent for clients that predate it. */
  gitIdentity?: { name: string; email: string } | null
}

export interface SandboxWorkspaceDto extends SandboxWorkspaceSpec {
  githubToken: string | null
  gpgKey: string | null
  /** The operator's user-level context as a JSON map of relative path to base64 content. */
  contextBundle: string | null
}
