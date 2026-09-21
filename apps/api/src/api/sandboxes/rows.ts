import type { CloudSandboxModel } from '../../db'
import type { SandboxStatusDto } from './sandboxes.types'
import { ESandboxState } from './sandboxes.types'

/**
 * The columns a status answer needs. Never widen this with the blob columns
 * (workspacePatch, workspaceContext, workspaceContextArchive): they are megabytes each, and the
 * status route is polled every 2s while a sandbox boots — an unselected read once burned 4.5GB of
 * Neon transfer in two days (2026-09-21).
 */
export type SandboxStatusColumns = Pick<
  CloudSandboxModel,
  'threadId' | 'name' | 'region' | 'state' | 'lastActivityAt'
>

export const SANDBOX_STATUS_SELECT = {
  threadId: true,
  name: true,
  region: true,
  state: true,
  lastActivityAt: true,
} as const

/** The identity columns a token check needs; the row's blob columns never ride along. */
export type SandboxPrincipal = Pick<CloudSandboxModel, 'id' | 'threadId' | 'userId'>

export function sandboxStateOf(value: string): ESandboxState {
  if (value === ESandboxState.Running) return ESandboxState.Running
  if (value === ESandboxState.Resuming) return ESandboxState.Resuming
  return ESandboxState.Parked
}

export function toSandboxDto(row: SandboxStatusColumns): SandboxStatusDto {
  return {
    threadId: row.threadId,
    name: row.name,
    region: row.region,
    state: sandboxStateOf(row.state),
    lastActivityAt: row.lastActivityAt,
  }
}
