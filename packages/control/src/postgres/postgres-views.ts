import { or, and, type Tx } from '@dltech/atlas-db'
import type { SessionChange } from '@dltech/atlas-protocol'

import type {
  PrHead,
  PrStateRow,
  SessionBranchRow,
  SessionViewRow,
  TrackedPullRequestRow,
} from '../port'
import { trackedPullRequestsOf } from '../tracked-pull-requests'
import { announceIn } from './postgres-notify'

export const readSessionViewIn = async (params: {
  tx: Tx
  sessionId: string
}): Promise<SessionViewRow | undefined> => {
  const row = await params.tx.orm.v2.V2SessionView.first({ sessionId: params.sessionId })
  if (row === null) return undefined
  return {
    sessionId: row.sessionId,
    threadId: row.threadId,
    atSeq: row.atSeq,
    version: row.version,
    state: row.state,
  }
}

export const writeSessionViewIn = async (params: {
  tx: Tx
  row: SessionViewRow
}): Promise<void> => {
  const { row } = params
  const fields = {
    threadId: row.threadId,
    atSeq: row.atSeq,
    version: row.version,
    state: row.state,
    updatedAt: new Date(),
  }
  await params.tx.orm.v2.V2SessionView.upsert({
    conflictOn: { sessionId: row.sessionId },
    create: { sessionId: row.sessionId, ...fields },
    update: fields,
  })
}

export const insertSessionBranchesIn = async (params: {
  tx: Tx
  rows: readonly SessionBranchRow[]
}): Promise<void> => {
  const { tx } = params
  for (const row of params.rows) {
    await tx.execute(
      tx.raw
        .sql`INSERT INTO "v2"."V2SessionBranch" ("sessionId", "headRepo", "branch", "firstSeenSeq")
        VALUES (${row.sessionId}, ${row.headRepo}, ${row.branch}, ${row.firstSeenSeq})
        ON CONFLICT ("sessionId", "headRepo", "branch") DO NOTHING`
        .affectedCount()
        .build(),
    )
  }
}

export const sessionsTrackingHeadIn = async (params: {
  tx: Tx
  headRepo: string
  branch: string
}): Promise<string[]> => {
  const rows = await params.tx.orm.v2.V2SessionBranch.where({
    headRepo: params.headRepo,
    branch: params.branch,
  }).all()
  return [...new Set(rows.map((row) => row.sessionId))]
}

const sessionBranchesIn = async (params: {
  tx: Tx
  sessionIds: readonly string[]
}): Promise<SessionBranchRow[]> => {
  if (params.sessionIds.length === 0) return []
  const rows = await params.tx.orm.v2.V2SessionBranch.where((branch) =>
    or(...params.sessionIds.map((sessionId) => branch.sessionId.eq(sessionId))),
  ).all()
  return rows.map((row) => ({
    sessionId: row.sessionId,
    headRepo: row.headRepo,
    branch: row.branch,
    firstSeenSeq: row.firstSeenSeq,
  }))
}

const prStatesForHeadsIn = async (params: {
  tx: Tx
  heads: readonly PrHead[]
}): Promise<PrStateRow[]> => {
  const heads = [
    ...new Map(params.heads.map((head) => [`${head.headRepo}\u0000${head.branch}`, head])).values(),
  ]
  if (heads.length === 0) return []
  const rows = await params.tx.orm.public.GithubPrState.where((state) =>
    or(
      ...heads.map((head) =>
        and(state.headRepoFullName.eq(head.headRepo), state.headBranch.eq(head.branch)),
      ),
    ),
  ).all()
  return rows.map((row) => ({
    repo: row.repoFullName,
    number: row.prNumber,
    title: row.title,
    state: row.state,
    headSha: row.headSha,
    checksRunning: row.checksRunning,
    checksPassed: row.checksPassed,
    checksFailed: row.checksFailed,
    mergeable: row.mergeable,
    updatedAt: row.updatedAt.toISOString(),
    headRepoFullName: row.headRepoFullName,
    headBranch: row.headBranch,
  }))
}

export const readTrackedPullRequestsIn = async (params: {
  tx: Tx
  sessionIds: readonly string[]
}): Promise<TrackedPullRequestRow[]> => {
  const branches = await sessionBranchesIn(params)
  const states = await prStatesForHeadsIn({
    tx: params.tx,
    heads: branches.map((branch) => ({ headRepo: branch.headRepo, branch: branch.branch })),
  })
  return trackedPullRequestsOf({ branches, states })
}

export const announceSessionChangesIn = async (params: {
  tx: Tx
  sessionIds: readonly string[]
}): Promise<void> => {
  for (const sessionId of params.sessionIds) {
    const change: SessionChange = { sessionId }
    await announceIn({ tx: params.tx, change })
  }
}
