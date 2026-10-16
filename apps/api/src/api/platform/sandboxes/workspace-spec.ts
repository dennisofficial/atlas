import { PayloadTooLargeException } from '@nestjs/common'
import type { CloudSandboxModel } from '../../../db'
import type { SandboxWorkspaceSpec } from './sandboxes.types'

/**
 * The legacy JSON `contextBundle` field, kept only for clients that predate the context-archive
 * endpoints. Kept in lockstep with `MAX_CONTEXT_BUNDLE_BYTES` in
 * `packages/harness/src/cloud/sandbox-client.ts` — `apps/api` carries no in-repo dependency by
 * design (see its AGENTS.md), so the value is duplicated rather than imported.
 */
export const MAX_CONTEXT_BUNDLE_BYTES = 64 * 1024 * 1024

/**
 * Must clear `MAX_CONTEXT_BUNDLE_BYTES` with headroom to spare: the bundle rides inside a JSON
 * string field of the request body, and base64 plus JSON escaping inflate it past the raw byte
 * count. A limit at or below the cap would 413 at the body parser before
 * `assertContextBundleWithinLimit` ever runs, so the friendlier error is unreachable.
 */
export const WORKSPACE_BODY_LIMIT = '96mb'

const mebibytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)}MiB`

export interface WorkspaceColumns {
  workspaceRemoteUrl: string | null
  workspaceContext: string | null
}

export function assertContextBundleWithinLimit(args: { bundle: string }): void {
  const bytes = Buffer.byteLength(args.bundle, 'utf8')
  if (bytes <= MAX_CONTEXT_BUNDLE_BYTES) return
  throw new PayloadTooLargeException(
    `the context bundle is ${mebibytes(bytes)}, over the ${mebibytes(MAX_CONTEXT_BUNDLE_BYTES)} limit — the conversation lifts without the user-level context`,
  )
}

export function workspaceColumnsOf(spec: SandboxWorkspaceSpec | undefined): WorkspaceColumns {
  if (spec === undefined) {
    return { workspaceRemoteUrl: null, workspaceContext: null }
  }
  return { workspaceRemoteUrl: spec.remoteUrl, workspaceContext: null }
}

export function workspaceSpecOf(
  row: Pick<CloudSandboxModel, 'workspaceRemoteUrl'>,
): SandboxWorkspaceSpec {
  return { remoteUrl: row.workspaceRemoteUrl }
}
