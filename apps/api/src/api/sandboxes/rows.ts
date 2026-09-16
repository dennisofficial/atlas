import type { CloudSandboxModel } from '../../db'
import type { SandboxStatusDto } from './sandboxes.types'
import { ESandboxState } from './sandboxes.types'

export function sandboxStateOf(value: string): ESandboxState {
  if (value === ESandboxState.Running) return ESandboxState.Running
  if (value === ESandboxState.Resuming) return ESandboxState.Resuming
  return ESandboxState.Parked
}

export function toSandboxDto(row: CloudSandboxModel): SandboxStatusDto {
  return {
    threadId: row.threadId,
    name: row.name,
    region: row.region,
    state: sandboxStateOf(row.state),
    lastActivityAt: row.lastActivityAt,
  }
}
