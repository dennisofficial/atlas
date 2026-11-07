import { or, and, type Tx } from '@dltech/atlas-db'
import type { SessionChange } from '@dltech/atlas-protocol'

import type {
  PrStateRow,
  SessionPullRequestKey,
  SessionPullRequestRow,
  SessionViewRow,
} from '../port'
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

export const insertSessionPullRequestsIn = async (params: {
  tx: Tx
  rows: readonly SessionPullRequestRow[]
}): Promise<void> => {
  const { tx } = params
  for (const row of params.rows) {
    await tx.execute(
      tx.raw.sql`INSERT INTO "v2"."V2SessionPullRequest" ("sessionId", "repo", "number")
        VALUES (${row.sessionId}, ${row.repo}, ${row.number})
        ON CONFLICT ("sessionId", "repo", "number") DO NOTHING`
        .affectedCount()
        .build(),
    )
  }
}

export const sessionsLinkedToIn = async (params: {
  tx: Tx
  repo: string
  number: number
}): Promise<string[]> => {
  const rows = await params.tx.orm.v2.V2SessionPullRequest.where({
    repo: params.repo,
    number: params.number,
  }).all()
  return rows.map((row) => row.sessionId)
}

export const readPrStatesIn = async (params: {
  tx: Tx
  keys: readonly SessionPullRequestKey[]
}): Promise<PrStateRow[]> => {
  if (params.keys.length === 0) return []
  const rows = await params.tx.orm.public.GithubPrState.where((s) =>
    or(...params.keys.map((key) => and(s.repoFullName.eq(key.repo), s.prNumber.eq(key.number)))),
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
  }))
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
