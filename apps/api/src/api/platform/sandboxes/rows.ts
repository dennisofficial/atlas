import type { CloudSandboxModel } from '../../../db'
import { SANDBOX_LIFECYCLE_SELECT, sandboxStateOf, type SandboxLifecycleColumns } from './sandbox-lifecycle'
import type { SandboxStatusDto } from './sandboxes.types'

/**
 * The columns a status answer needs. Never widen this with the `workspacePatch` blob column: it
 * can be megabytes, and the status route is polled every 2s while a sandbox boots — an unselected
 * read once burned 4.5GB of database transfer in two days (2026-09-21).
 */
export type SandboxStatusColumns = SandboxLifecycleColumns &
  Pick<CloudSandboxModel, 'name' | 'region' | 'lastActivityAt' | 'contextPending' | 'serveUrl'>

export const SANDBOX_STATUS_SELECT = {
  ...SANDBOX_LIFECYCLE_SELECT,
  name: true,
  region: true,
  lastActivityAt: true,
  contextPending: true,
  serveUrl: true,
} as const

/** The identity columns a token check needs; the row's blob columns never ride along. */
export type SandboxPrincipal = Pick<CloudSandboxModel, 'id' | 'threadId' | 'userId'>

export function toSandboxDto(row: SandboxStatusColumns): SandboxStatusDto {
  return {
    threadId: row.threadId,
    name: row.name,
    region: row.region,
    state: sandboxStateOf(row),
    lastActivityAt: row.lastActivityAt,
    contextPending: row.contextPending,
  }
}
