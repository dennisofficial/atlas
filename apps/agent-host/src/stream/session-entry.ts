import {
  NAMING_WINDOW_MS,
  sessionSummaryOf,
  type ControlSessionDigest,
} from '@dltech/atlas-control'
import type { SessionSummary } from '@dltech/atlas-protocol'

export type SessionEntry = {
  row: SessionSummary
  userId: string
  projectId: string
  namingEndsAt: number | undefined
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
