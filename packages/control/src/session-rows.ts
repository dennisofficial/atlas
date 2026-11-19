import type { SessionStatus } from '@dltech/atlas-core'

export type ControlSessionRow = {
  sessionId: string
  userId: string
  projectId: string | null
  title: string | null
  mainThreadId: string
  createdAt: string
  archivedAt: string | null
  deletedAt: string | null
  modelRef: string
  modelEffort: string
  modelFast: boolean
  spawnedBySessionId: string | null
  nested: boolean
  podSessionId: string | null
  routineId: string | null
}

export type SessionListParams = {
  userId: string
  projectId?: string | undefined
  sessionId?: string | undefined
  spawnedBySessionId?: string | undefined
  limit: number
}

export type SessionDigestRow = ControlSessionRow & {
  lastEventAt: string | null
  lastAssistantSeq: number
  readSeq: number | null
  firstMessageText: string | null
  firstMessageAt: string | null
}

export type PrChecks = { running: number; passed: number; failed: number; expected: number }

export type ControlDigestPullRequest = {
  repo: string
  number: number
  url: string
  state: string | null
  checks: PrChecks | null
  mergeable: boolean | null
}

export type ControlDigestView = {
  status: SessionStatus
  primaryBranch: string | null
  pullRequest: ControlDigestPullRequest | null
}

export type ControlSessionDigest = SessionDigestRow & { view: ControlDigestView | null }

export type SessionModelRow = { modelRef: string; modelEffort: string; modelFast: boolean }
