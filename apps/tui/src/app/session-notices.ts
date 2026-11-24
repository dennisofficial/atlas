import { ESessionStatus } from '@dltech/atlas-core'
import type { StreamSessionRow } from '@dltech/atlas-protocol'

export type SessionNotice = { key: string; text: string }

export const RAN_STATES: ReadonlySet<ESessionStatus> = new Set([
  ESessionStatus.Queued,
  ESessionStatus.Thinking,
  ESessionStatus.RunningTool,
  ESessionStatus.Resuming,
  ESessionStatus.WaitingToRetry,
  ESessionStatus.WaitingForCredentials,
  ESessionStatus.WaitingForOperator,
  ESessionStatus.WaitingForBackground,
])

export const DONE_STATES: ReadonlySet<ESessionStatus> = new Set([
  ESessionStatus.Idle,
  ESessionStatus.Failed,
])

const titleOf = (row: StreamSessionRow): string => {
  const trimmed = row.title?.trim() ?? ''
  return trimmed === '' ? row.sessionId : trimmed
}

export const finishedNoticesOf = (args: {
  previous: readonly StreamSessionRow[]
  next: readonly StreamSessionRow[]
  watching: string | null
}): readonly SessionNotice[] => {
  const before = new Map(args.previous.map((row) => [row.sessionId, row]))
  const notices: SessionNotice[] = []

  for (const row of args.next) {
    if (row.sessionId === args.watching) continue
    if (row.archivedAt !== null) continue
    const status = row.status?.state
    if (status === undefined || !DONE_STATES.has(status)) continue

    const was = before.get(row.sessionId)?.status?.state
    if (was === undefined || !RAN_STATES.has(was)) continue

    notices.push({
      key: `session-${row.sessionId}`,
      text: `${titleOf(row)} ${status === ESessionStatus.Failed ? 'failed' : 'finished'}`,
    })
  }

  return notices
}
