export enum ESandboxState {
  Running = 'running',
  Parked = 'parked',
  Resuming = 'resuming',
}

export interface SandboxStatusDto {
  threadId: string
  name: string
  region: string
  state: ESandboxState
  lastActivityAt: string
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
}

export interface SandboxWorkspaceDto extends SandboxWorkspaceSpec {
  githubToken: string | null
  /** The operator's user-level context as a JSON map of relative path to base64 content. */
  contextBundle: string | null
}
