import { or, and, type Tx } from '@dltech/atlas-db'
import type { SessionChange } from '@dltech/atlas-protocol'

import type {
  PrHead,
  PrRef,
  PrStateRow,
  SessionBranchRow,
  SessionPullRequestRow,
  SessionViewRow,
  TrackedPullRequestRow,
} from '../port'
import { repoFullNameOf } from '../repo-name'
import { trackedPullRequestsOf } from '../tracked-pull-requests'
import { announceIn } from './postgres-notify'

export const readSessionViewIn = async (params: {
  tx: Tx
  sessionId: string
}): Promise<SessionViewRow | undefined> => {
  const row = await params.tx.orm.public.SessionView.first({ sessionId: params.sessionId })
  if (row === null) return undefined
  return {
    sessionId: row.sessionId,
    threadId: row.threadId,
    atSeq: row.atSeq,
    version: row.version,
    state: row.state,
  }
}

export const readSessionViewsIn = async (params: {
  tx: Tx
  sessionIds: readonly string[]
}): Promise<SessionViewRow[]> => {
  if (params.sessionIds.length === 0) return []
  const rows = await params.tx.orm.public.SessionView.where((view) =>
    view.sessionId.in([...params.sessionIds]),
  ).all()
  return rows.map((row) => ({
    sessionId: row.sessionId,
    threadId: row.threadId,
    atSeq: row.atSeq,
    version: row.version,
    state: row.state,
  }))
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
  await params.tx.orm.public.SessionView.upsert({
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
      row.firstSeenAt === null
        ? tx.raw
            .sql`INSERT INTO "public"."SessionBranch" ("sessionId", "headRepo", "branch", "firstSeenSeq")
            VALUES (${row.sessionId}, ${row.headRepo}, ${row.branch}, ${row.firstSeenSeq})
            ON CONFLICT ("sessionId", "headRepo", "branch") DO NOTHING`
            .affectedCount()
            .build()
        : tx.raw
            .sql`INSERT INTO "public"."SessionBranch" ("sessionId", "headRepo", "branch", "firstSeenSeq", "firstSeenAt")
            VALUES (${row.sessionId}, ${row.headRepo}, ${row.branch}, ${row.firstSeenSeq}, ${row.firstSeenAt}::timestamptz)
            ON CONFLICT ("sessionId", "headRepo", "branch") DO NOTHING`
            .affectedCount()
            .build(),
    )
  }
}

export const insertSessionPullRequestsIn = async (params: {
  tx: Tx
  rows: readonly SessionPullRequestRow[]
}): Promise<void> => {
  const { tx } = params
  for (const row of params.rows) {
    await tx.execute(
      tx.raw.sql`INSERT INTO "public"."SessionPullRequest" ("sessionId", "repoFullName", "prNumber")
        VALUES (${row.sessionId}, ${repoFullNameOf(row.repo)}, ${row.number})
        ON CONFLICT ("sessionId", "repoFullName", "prNumber") DO NOTHING`
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
  const rows = await params.tx.orm.public.SessionBranch.where({
    headRepo: params.headRepo,
    branch: params.branch,
  }).all()
  return [...new Set(rows.map((row) => row.sessionId))]
}

export const sessionsTrackingPullRequestIn = async (params: {
  tx: Tx
  repo: string
  number: number
}): Promise<string[]> => {
  const rows = await params.tx.orm.public.SessionPullRequest.where({
    repoFullName: repoFullNameOf(params.repo),
    prNumber: params.number,
  }).all()
  return [...new Set(rows.map((row) => row.sessionId))]
}

const sessionBranchesIn = async (params: {
  tx: Tx
  sessionIds: readonly string[]
}): Promise<SessionBranchRow[]> => {
  if (params.sessionIds.length === 0) return []
  const rows = await params.tx.orm.public.SessionBranch.where((branch) =>
    or(...params.sessionIds.map((sessionId) => branch.sessionId.eq(sessionId))),
  ).all()
  return rows.map((row) => ({
    sessionId: row.sessionId,
    headRepo: row.headRepo,
    branch: row.branch,
    firstSeenSeq: row.firstSeenSeq,
    firstSeenAt: row.firstSeenAt === null ? null : row.firstSeenAt.toISOString(),
  }))
}

const sessionPullRequestsIn = async (params: {
  tx: Tx
  sessionIds: readonly string[]
}): Promise<SessionPullRequestRow[]> => {
  if (params.sessionIds.length === 0) return []
  const rows = await params.tx.orm.public.SessionPullRequest.where((pullRequest) =>
    or(...params.sessionIds.map((sessionId) => pullRequest.sessionId.eq(sessionId))),
  ).all()
  return rows.map((row) => ({
    sessionId: row.sessionId,
    repo: row.repoFullName,
    number: row.prNumber,
  }))
}

const prStateRowOf = (row: {
  repoFullName: string
  prNumber: number
  title: string
  state: string
  headSha: string
  checksRunning: number
  checksPassed: number
  checksFailed: number
  checksExpected: number
  mergeQueued: boolean
  autoMerge: boolean
  mergeable: boolean | null
  updatedAt: Date
  closedAt: Date | null
  mergedAt: Date | null
  headRepoFullName: string | null
  headBranch: string
}): PrStateRow => ({
  repo: row.repoFullName,
  number: row.prNumber,
  title: row.title,
  state: row.state,
  headSha: row.headSha,
  checksRunning: row.checksRunning,
  checksPassed: row.checksPassed,
  checksFailed: row.checksFailed,
  checksExpected: row.checksExpected,
  mergeQueued: row.mergeQueued,
  autoMerge: row.autoMerge,
  mergeable: row.mergeable,
  updatedAt: row.updatedAt.toISOString(),
  closedAt: row.closedAt === null ? null : row.closedAt.toISOString(),
  mergedAt: row.mergedAt === null ? null : row.mergedAt.toISOString(),
  headRepoFullName: row.headRepoFullName,
  headBranch: row.headBranch,
})

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
  return rows.map(prStateRowOf)
}

const prStatesForNumbersIn = async (params: {
  tx: Tx
  pullRequests: readonly PrRef[]
}): Promise<PrStateRow[]> => {
  const pullRequests = [
    ...new Map(
      params.pullRequests.map((pullRequest) => [
        `${pullRequest.repo}#${pullRequest.number}`,
        pullRequest,
      ]),
    ).values(),
  ]
  if (pullRequests.length === 0) return []
  const rows = await params.tx.orm.public.GithubPrState.where((state) =>
    or(
      ...pullRequests.map((pullRequest) =>
        and(
          state.repoFullName.eq(repoFullNameOf(pullRequest.repo)),
          state.prNumber.eq(pullRequest.number),
        ),
      ),
    ),
  ).all()
  return rows.map(prStateRowOf)
}

export const readTrackedPullRequestsIn = async (params: {
  tx: Tx
  sessionIds: readonly string[]
}): Promise<TrackedPullRequestRow[]> => {
  const branches = await sessionBranchesIn(params)
  const subscriptions = await sessionPullRequestsIn(params)
  const states = [
    ...(await prStatesForHeadsIn({
      tx: params.tx,
      heads: branches.map((branch) => ({ headRepo: branch.headRepo, branch: branch.branch })),
    })),
    ...(await prStatesForNumbersIn({
      tx: params.tx,
      pullRequests: subscriptions.map((subscription) => ({
        repo: subscription.repo,
        number: subscription.number,
      })),
    })),
  ]
  return trackedPullRequestsOf({ branches, subscriptions, states })
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
