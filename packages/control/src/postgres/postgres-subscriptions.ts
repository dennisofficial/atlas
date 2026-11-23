import type { Tx } from '@dltech/atlas-db'
import { jsonValueSchema, type JsonValue } from '@dltech/atlas-core'

import { expiresAtOf, expiryInstantOf } from './no-expiry'
import {
  subscriptionSubjectKey,
  type SubscriptionKey,
  type SubscriptionLease,
  type SubscriptionDraft,
  type SubscriptionLeaseKey,
  type SubscriptionRow,
  type WrittenSubscriptionRow,
} from '../port'

const GITHUB_PREFIX = /^github\.com\//i

const WORKFLOW_RUN_KIND = 'workflow-run'

const firstRunWatermark = new Date(0)

const rowOf = (params: SubscriptionLeaseKey) => ({
  userId: params.userId,
  repoFullName: params.repo.replace(GITHUB_PREFIX, '').toLowerCase(),
  branch: subscriptionSubjectKey(params.subject),
  threadId: params.threadId,
})

const prNumberOf = (params: SubscriptionLease): number | null =>
  params.subject.kind === 'pull-request' ? params.subject.number : null

export const upsertSubscriptionLeaseIn = async (
  params: SubscriptionLease & { tx: Tx; expiresAt: string },
): Promise<void> => {
  const key = rowOf(params)
  const prNumber = prNumberOf(params)
  const expiresAt = new Date(params.expiresAt)
  await params.tx.orm.public.GithubSubscription.upsert({
    conflictOn: key,
    create: {
      ...key,
      kind: params.subject.kind,
      prNumber,
      pollBacked: true,
      expiresAt,
      liveUntil: expiresAt,
      events: [...params.events],
    },
    update: {
      kind: params.subject.kind,
      prNumber,
      expiresAt,
      liveUntil: expiresAt,
      events: [...params.events],
    },
  })
}

export const deleteSubscriptionLeaseIn = async (
  params: SubscriptionLeaseKey & { tx: Tx },
): Promise<boolean> => {
  const removed = await params.tx.orm.public.GithubSubscription.where(
    rowOf(params),
  ).deleteAndCount()
  return removed > 0
}

type SubscriptionRecord = SubscriptionKey & {
  id: string
  sessionId: string
  provider: string
  kind: string
  prNumber: number | null
  target: unknown
  label: string
  createdBy: string
  events: readonly string[]
  expiresAt: Date
  deadline: Date | null
  createdAt: Date
}

const jsonValueOf = (value: unknown): JsonValue | null => {
  const parsed = jsonValueSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

const rowToRow = (row: SubscriptionRecord): SubscriptionRow => ({
  subscriptionId: row.id,
  userId: row.userId,
  sessionId: row.sessionId,
  repoFullName: row.repoFullName,
  branch: row.branch,
  threadId: row.threadId,
  provider: row.provider,
  kind: row.kind,
  prNumber: row.prNumber,
  target: jsonValueOf(row.target),
  label: row.label,
  createdBy: row.createdBy,
  events: [...row.events],
  expiresAt: expiresAtOf(row.expiresAt),
  deadline: row.deadline?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})

const keyOf = (key: SubscriptionKey) => ({
  userId: key.userId,
  repoFullName: key.repoFullName,
  branch: key.branch,
  threadId: key.threadId,
})

const timeOf = (value: string | null): Date | null => (value === null ? null : new Date(value))

export const lockSubscriptionKeyIn = async (params: {
  tx: Tx
  key: SubscriptionKey
}): Promise<void> => {
  const key = [
    params.key.userId,
    params.key.repoFullName,
    params.key.branch,
    params.key.threadId,
  ].join(' ')
  await params.tx.query(
    params.tx.raw.sql`SELECT pg_advisory_xact_lock(hashtext(${key}::text)), 1 AS "held"`
      .returnsRow({ held: 'pg/int4@1' })
      .build(),
  )
}

export const findSubscriptionIn = async (params: {
  tx: Tx
  key: SubscriptionKey
}): Promise<SubscriptionRow | undefined> => {
  const held = await params.tx.orm.public.GithubSubscription.where(keyOf(params.key)).first()
  return held === null ? undefined : rowToRow(held)
}

export const readSubscriptionIn = async (params: {
  tx: Tx
  subscriptionId: string
}): Promise<SubscriptionRow | undefined> => {
  const held = await params.tx.orm.public.GithubSubscription.where({
    id: params.subscriptionId,
  }).first()
  return held === null ? undefined : rowToRow(held)
}

export const threadIdsOfSessionIn = async (params: {
  tx: Tx
  sessionId: string
}): Promise<string[]> => {
  const session = await params.tx.orm.v2.V2Session.where({ id: params.sessionId })
    .select('mainThreadId')
    .first()
  const threads = await params.tx.orm.v2.V2Thread.where({ sessionId: params.sessionId })
    .select('id')
    .all()
  return [
    ...new Set([
      ...(session === null ? [] : [session.mainThreadId]),
      ...threads.map((thread) => thread.id),
    ]),
  ]
}

export const readSessionSubscriptionRowsIn = async (params: {
  tx: Tx
  sessionId: string
}): Promise<SubscriptionRow[]> => {
  const threadIds = await threadIdsOfSessionIn({ tx: params.tx, sessionId: params.sessionId })
  if (threadIds.length === 0) return []
  const rows = await params.tx.orm.public.GithubSubscription.where((subscription) =>
    subscription.threadId.in(threadIds),
  ).all()
  return rows.map(rowToRow)
}

export const insertSubscriptionRowIn = async (params: {
  tx: Tx
  row: SubscriptionDraft
}): Promise<WrittenSubscriptionRow> => {
  const { row } = params
  const runWatermark = row.kind === WORKFLOW_RUN_KIND ? { lastRunCreatedAt: firstRunWatermark } : {}
  await params.tx.orm.public.GithubSubscription.createAndCount([
    {
      ...keyOf(row),
      sessionId: row.sessionId,
      provider: row.provider,
      kind: row.kind,
      prNumber: row.prNumber,
      target: row.target,
      label: row.label,
      createdBy: row.createdBy,
      events: [...row.events],
      expiresAt: expiryInstantOf(row.expiresAt),
      liveUntil: expiryInstantOf(row.expiresAt),
      deadline: timeOf(row.deadline),
      createdAt: new Date(row.createdAt),
      ...runWatermark,
    },
  ])
  const created = await params.tx.orm.public.GithubSubscription.where(keyOf(row)).first()
  if (created === null) throw new Error('the subscription row was not written')
  return { row: rowToRow(created), inserted: true }
}

export const updateSubscriptionRowIn = async (params: {
  tx: Tx
  subscriptionId: string
  provider: string
  target: JsonValue
  label: string
  events: readonly string[]
  expiresAt: string | null
  deadline: string | null
}): Promise<boolean> => {
  const updated = await params.tx.orm.public.GithubSubscription.where({
    id: params.subscriptionId,
  }).updateAndCount({
    provider: params.provider,
    target: params.target,
    label: params.label,
    events: [...params.events],
    expiresAt: expiryInstantOf(params.expiresAt),
    liveUntil: expiryInstantOf(params.expiresAt),
    deadline: timeOf(params.deadline),
  })
  return updated > 0
}

export const deleteSubscriptionRowIn = async (params: {
  tx: Tx
  subscriptionId: string
}): Promise<boolean> => {
  const removed = await params.tx.orm.public.GithubSubscription.where({
    id: params.subscriptionId,
  }).deleteAndCount()
  return removed > 0
}

export const deleteSubscriptionRowIfEndedBeforeIn = async (params: {
  tx: Tx
  subscriptionId: string
  at: string
}): Promise<boolean> => {
  const { affectedRows } = await params.tx.execute(
    params.tx.raw.sql`
    DELETE FROM "public"."GithubSubscription"
    WHERE "id" = ${params.subscriptionId}
      AND (
        "deadline" < ${params.at}::timestamptz
        OR ("expiresAt" < ${params.at}::timestamptz AND "liveUntil" < ${params.at}::timestamptz)
      )
  `
      .affectedCount()
      .build(),
  )
  return affectedRows > 0
}
