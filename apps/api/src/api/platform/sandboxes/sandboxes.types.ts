export enum ESandboxState {
  Running = 'running',
  Parked = 'parked',
  Resuming = 'resuming',
}

/**
 * Mirrors the `SandboxMountMode` of the installed `@vercel/sandbox` SDK, restated here so the
 * database column and the SDK call site share one vocabulary without re-exporting SDK types.
 */
export enum ESandboxDriveMode {
  ReadWrite = 'read-write',
  Snapshot = 'snapshot',
}

/**
 * Which factory seat a sandbox serves, told to the serve process inside as ATLAS_FACTORY_ROLE so
 * its role-gated plugin tools activate. Absent for ordinary (non-factory) sandboxes.
 */
export enum ESandboxFactoryRole {
  Orchestrator = 'orchestrator',
  Station = 'station',
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
