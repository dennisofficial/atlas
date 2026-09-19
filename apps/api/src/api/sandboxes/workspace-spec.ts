import { PayloadTooLargeException } from '@nestjs/common'
import type { CloudSandboxModel } from '../../db'
import type { SandboxWorkspaceSpec } from './sandboxes.types'

export const MAX_WORKSPACE_PATCH_BYTES = 5 * 1024 * 1024

export const MAX_SKILLS_BUNDLE_BYTES = 4 * 1024 * 1024

export const WORKSPACE_BODY_LIMIT = '8mb'

const mebibytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)}MiB`

export interface WorkspaceColumns {
  workspaceRemoteUrl: string | null
  workspaceBranch: string | null
  workspaceCommit: string | null
  workspacePatch: string | null
  workspaceSkills: string | null
}

export function assertSkillsBundleWithinLimit(args: { bundle: string }): void {
  const bytes = Buffer.byteLength(args.bundle, 'utf8')
  if (bytes <= MAX_SKILLS_BUNDLE_BYTES) return
  throw new PayloadTooLargeException(
    `the skills bundle is ${mebibytes(bytes)}, over the ${mebibytes(MAX_SKILLS_BUNDLE_BYTES)} limit — the conversation lifts without the user-level skills`,
  )
}

export function assertPatchWithinLimit(args: { patch: string }): void {
  const bytes = Buffer.byteLength(args.patch, 'utf8')
  if (bytes <= MAX_WORKSPACE_PATCH_BYTES) return
  throw new PayloadTooLargeException(
    `the workspace patch is ${mebibytes(bytes)}, over the ${mebibytes(MAX_WORKSPACE_PATCH_BYTES)} limit: commit or discard some of this work before lifting the session`,
  )
}

export function workspaceColumnsOf(spec: SandboxWorkspaceSpec | undefined): WorkspaceColumns {
  if (spec === undefined) {
    return {
      workspaceRemoteUrl: null,
      workspaceBranch: null,
      workspaceCommit: null,
      workspacePatch: null,
      workspaceSkills: null,
    }
  }
  assertPatchWithinLimit({ patch: spec.patch })
  return {
    workspaceRemoteUrl: spec.remoteUrl,
    workspaceBranch: spec.branch,
    workspaceCommit: spec.commit,
    workspacePatch: spec.patch,
    workspaceSkills: null,
  }
}

export function workspaceSpecOf(row: CloudSandboxModel): SandboxWorkspaceSpec {
  return {
    remoteUrl: row.workspaceRemoteUrl,
    branch: row.workspaceBranch,
    commit: row.workspaceCommit,
    patch: row.workspacePatch ?? '',
  }
}
