import type { SessionStatus, ETurnEndedBy, ETurnOutcome } from '@dltech/atlas-core'
import type { SessionSandboxStatus } from '@dltech/atlas-protocol'

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
  sandboxProvider: string
  credentialSource: string
  sandboxInstanceId: string | null
  sandboxStatus: string | null
  sandboxStatusAt: string | null
  sandboxStatusReason: string | null
  spawnedBySessionId: string | null
  nested: boolean
  podSessionId: string | null
  podDesiredVcpus: number | null
  podDesiredMemoryGb: number | null
  podDesiredDiskGb: number | null
  podSizeGeneration: number
  podActualVcpus: number | null
  podActualMemoryGb: number | null
  podAppliedGeneration: number | null
  podResizeError: string | null
  podWaitingSince: string | null
  routineId: string | null
}

export type SessionBucketFilter = { archived: true } | { archived: false; idleBefore: string }

export type SessionPageCursor = { createdAt: string; sessionId: string }

export type SessionListParams = {
  userId: string
  projectId?: string | undefined
  sessionId?: string | undefined
  spawnedBySessionId?: string | undefined
  limit: number
  bucket?: SessionBucketFilter | undefined
  search?: string | undefined
  after?: SessionPageCursor | undefined
}

export type SessionBucketCountParams = {
  userId: string
  idleBefore: string
  search?: string | undefined
}

export type SessionBucketCounts = { inactive: number; archived: number }

export type SessionTurnEnding = {
  seq: number
  outcome: ETurnOutcome
  by: ETurnEndedBy
}

export type SessionDigestRow = ControlSessionRow & {
  lastEventAt: string | null
  lastAssistantSeq: number
  lastTurn: SessionTurnEnding | null
  headSeq: number
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
  mergeQueued: boolean
  autoMerge: boolean
}

export type ControlDigestView = {
  status: SessionStatus
  primaryBranch: string | null
  pullRequest: ControlDigestPullRequest | null
  sandbox: SessionSandboxStatus | null
}

export type ControlSessionDigest = SessionDigestRow & { view: ControlDigestView | null }

export type SessionModelRow = { modelRef: string; modelEffort: string; modelFast: boolean }
