import type { CloudSandboxModel } from '../../../db'
import type { SandboxWorkspaceSpec } from './sandboxes.types'

export interface WorkspaceColumns {
  workspaceRemoteUrl: string | null
}

export function workspaceColumnsOf(spec: SandboxWorkspaceSpec | undefined): WorkspaceColumns {
  return { workspaceRemoteUrl: spec?.remoteUrl ?? null }
}

export function workspaceSpecOf(
  row: Pick<CloudSandboxModel, 'workspaceRemoteUrl'>,
): SandboxWorkspaceSpec {
  return { remoteUrl: row.workspaceRemoteUrl }
}
