import {
  NAMING_WINDOW_MS,
  sessionSummaryOf,
  type ControlSessionDigest,
} from '@dltech/atlas-control'
import { STREAM_SESSION_VIEW_VERSION, type SessionSummary } from '@dltech/atlas-protocol'

export type SessionEntry = {
  row: SessionSummary
  userId: string
  projectId: string
  namingEndsAt: number | undefined
}

export const rowForVersion = (args: { row: SessionSummary; version: number }): SessionSummary => {
  if (args.version >= STREAM_SESSION_VIEW_VERSION) return args.row
  const {
    status: _status,
    primaryBranch: _branch,
    pullRequest: _pr,
    spawnedBy: _spawnedBy,
    ...legacy
  } = args.row
  return legacy
}

export const entryOf = (args: { digest: ControlSessionDigest; now: number }): SessionEntry => {
  const { digest } = args
  const row = sessionSummaryOf(args)
  const first = digest.firstMessageAt
  return {
    row,
    userId: digest.userId,
    projectId: digest.projectId,
    namingEndsAt: row.naming && first !== null ? Date.parse(first) + NAMING_WINDOW_MS : undefined,
  }
}
