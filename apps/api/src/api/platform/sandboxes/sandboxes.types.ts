export enum ESandboxState {
  Running = 'running',
  Parked = 'parked',
  Resuming = 'resuming',
}

export interface SandboxListEntryDto {
  threadId: string
  name: string
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

/** A cloud-born sandbox clones the repo's default branch from origin; the remote is all it needs. */
export interface SandboxWorkspaceSpec {
  remoteUrl: string | null
}

export interface SandboxWorkspaceDto extends SandboxWorkspaceSpec {
  githubToken: string | null
  /** The operator's user-level context as a JSON map of relative path to base64 content. */
  contextBundle: string | null
}
