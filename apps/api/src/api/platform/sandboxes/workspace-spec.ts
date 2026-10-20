import type { SandboxWorkspaceSpec } from './sandboxes.types'

export interface WorkspaceColumns {
  workspaceRemoteUrl: string | null
}

export function workspaceColumnsOf(spec: SandboxWorkspaceSpec | undefined): WorkspaceColumns {
  return { workspaceRemoteUrl: spec?.remoteUrl ?? null }
}
