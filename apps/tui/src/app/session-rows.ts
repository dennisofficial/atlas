import { EExecutionLocation } from '@dltech/atlas-core'
import type { StreamSessionRow } from '@dltech/atlas-protocol'

import type { ThreadRow } from '../ui/threads-model'

const labelOf = (row: StreamSessionRow): { label: string; titled: boolean } => {
  const title = row.title?.trim() ?? ''
  return title === '' ? { label: row.sessionId, titled: false } : { label: title, titled: true }
}

export const sessionRowsOf = (args: {
  rows: readonly StreamSessionRow[]
  now: number
  activeSessionId: string | null
}): readonly ThreadRow[] =>
  args.rows
    .filter(
      (row) => row.archivedAt === null && (row.spawnedBy === null || row.spawnedBy === undefined),
    )
    .map((row) => ({
      threadId: row.sessionId,
      ...labelOf(row),
      updatedAt: row.updatedAt,
      active: row.sessionId === args.activeSessionId,
      location: EExecutionLocation.Cloud,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
