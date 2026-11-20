import {
  clipCheckText,
  checkRunOutcomeOf,
  checksTally,
  ECheckOutcome,
  latestCheckAttempts,
  statusContextOutcomeOf,
  type ChecksCount,
} from '@dltech/atlas-core'
import { db, type Row, type Tx } from '@dltech/atlas-db'
import { normalizedRepo } from './github-pr-identity'
import { checkIdentitiesOf, type CheckIdentityRow } from './github-pr-row-fold'
import { lockPrScope } from './github-pr-lock'
import type { GithubPrCheckAnnotation } from './github-realtime.types'

export const COMMIT_CHECK_RETENTION_MS = 14 * 24 * 60 * 60 * 1_000
export const COMMIT_CHECK_TOUCH_MS = 24 * 60 * 60 * 1_000

export type CommitCheckInput = {
  checkKey: string
  sourceId?: string | null
  name: string
  startedAt: string | null
  outcome: ECheckOutcome
  sourceUpdatedAt: Date
  isRun: boolean
  conclusion?: string | null
  appSlug?: string | null
  detailsUrl?: string | null
  title?: string | null
  summary?: string | null
  annotationsCount?: number | null
  annotations?: GithubPrCheckAnnotation[]
}

export type CheckRunShape = {
  id: number
  name: string
  status: string
  conclusion: string | null
  started_at: string | null
  completed_at?: string | null
  app?: { slug: string } | null
  html_url?: string | null
  output?: {
    title?: string | null
    summary?: string | null
    annotations_count?: number | null
  } | null
}

export type CommitStatusShape = {
  id?: number
  context: string
  state: string
  created_at: string | null
  updated_at?: string | null
  target_url?: string | null
  description?: string | null
}

const timeOf = (iso: string | null | undefined): Date | null =>
  iso === null || iso === undefined ? null : new Date(iso)

export function checkRunInputOf(run: CheckRunShape): CommitCheckInput {
  return {
    checkKey: `run:${run.id}`,
    sourceId: String(run.id),
    name: run.name,
    startedAt: run.started_at,
    outcome: checkRunOutcomeOf({
      status: run.status,
      conclusion: run.conclusion,
    }),
    sourceUpdatedAt: timeOf(run.completed_at) ?? timeOf(run.started_at) ?? new Date(),
    isRun: true,
    conclusion: run.conclusion?.toLowerCase() ?? null,
    appSlug: run.app?.slug ?? null,
    detailsUrl: run.html_url ?? null,
    title: clipCheckText(run.output?.title) ?? null,
    summary: clipCheckText(run.output?.summary) ?? null,
    annotationsCount: run.output?.annotations_count ?? null,
  }
}

export function commitStatusInputOf(status: CommitStatusShape): CommitCheckInput {
  return {
    checkKey: `status:${status.context}`,
    sourceId: status.id === undefined ? null : String(status.id),
    name: status.context,
    startedAt: status.created_at,
    outcome: statusContextOutcomeOf(status.state),
    sourceUpdatedAt: timeOf(status.updated_at) ?? timeOf(status.created_at) ?? new Date(),
    isRun: false,
    detailsUrl: status.target_url ?? null,
    summary: clipCheckText(status.description) ?? null,
  }
}

export async function recordCommitChecksLocked(args: {
  repoFullName: string
  headSha: string
  checks: readonly CommitCheckInput[]
}): Promise<void> {
  if (args.checks.length === 0) return
  await db.transaction(async (tx) => {
    const scope = await lockPrScope({ tx, repoFullName: args.repoFullName })
    await recordCommitChecks({ tx: scope, ...args })
  })
}

export type HeldCommitCheck = Pick<
  Row<'GithubCommitCheck'>,
  | 'checkKey'
  | 'sourceId'
  | 'name'
  | 'startedAt'
  | 'outcome'
  | 'sourceUpdatedAt'
  | 'conclusion'
  | 'appSlug'
  | 'detailsUrl'
  | 'title'
  | 'summary'
  | 'annotationsCount'
  | 'annotations'
  | 'updatedAt'
>

type CommitCheckWrite = {
  sourceId: string | null
  name: string
  startedAt: string | null
  outcome: ECheckOutcome
  sourceUpdatedAt: Date
  conclusion: string | null
  appSlug: string | null
  detailsUrl: string | null
  title: string | null
  summary: string | null
  annotationsCount: number | null
  annotations?: GithubPrCheckAnnotation[]
}

function newerThanHeld(args: { held: HeldCommitCheck; check: CommitCheckInput }): boolean {
  const heldAt = args.held.sourceUpdatedAt.getTime()
  const checkAt = args.check.sourceUpdatedAt.getTime()
  if (heldAt !== checkAt) return heldAt > checkAt

  return Number(args.held.sourceId ?? '') > Number(args.check.sourceId ?? '')
}

function writeOf(check: CommitCheckInput): CommitCheckWrite {
  return {
    sourceId: check.sourceId ?? null,
    name: check.name,
    startedAt: check.startedAt,
    outcome: check.outcome,
    sourceUpdatedAt: check.sourceUpdatedAt,
    conclusion: check.conclusion ?? null,
    appSlug: check.appSlug ?? null,
    detailsUrl: check.detailsUrl ?? null,
    title: check.title ?? null,
    summary: check.summary ?? null,
    annotationsCount: check.annotationsCount ?? null,
    ...(check.annotations === undefined ? {} : { annotations: check.annotations }),
  }
}

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function heldMatchesWrite(args: { held: HeldCommitCheck; write: CommitCheckWrite }): boolean {
  const { held, write } = args
  if (held.sourceId !== write.sourceId) return false
  if (held.name !== write.name) return false
  if (held.startedAt !== write.startedAt) return false
  if (held.outcome !== write.outcome) return false
  if (held.sourceUpdatedAt.getTime() !== write.sourceUpdatedAt.getTime()) return false
  if (held.conclusion !== write.conclusion) return false
  if (held.appSlug !== write.appSlug) return false
  if (held.detailsUrl !== write.detailsUrl) return false
  if (held.title !== write.title) return false
  if (held.summary !== write.summary) return false
  if (held.annotationsCount !== write.annotationsCount) return false
  if (write.annotations === undefined) return true
  return stableJson(held.annotations) === stableJson(write.annotations)
}

export async function readCommitChecks(args: {
  tx: Tx
  repoFullName: string
  headSha: string
}): Promise<HeldCommitCheck[]> {
  return await args.tx.orm.public.GithubCommitCheck.select(
    'checkKey',
    'sourceId',
    'name',
    'startedAt',
    'outcome',
    'sourceUpdatedAt',
    'conclusion',
    'appSlug',
    'detailsUrl',
    'title',
    'summary',
    'annotationsCount',
    'annotations',
    'updatedAt',
  )
    .where({ repoFullName: normalizedRepo(args.repoFullName), headSha: args.headSha })
    .all()
}

export async function recordCommitChecks(args: {
  tx: Tx
  repoFullName: string
  headSha: string
  checks: readonly CommitCheckInput[]
  held?: readonly HeldCommitCheck[]
}): Promise<readonly HeldCommitCheck[]> {
  if (args.checks.length === 0) return args.held ?? []
  const repoFullName = normalizedRepo(args.repoFullName)
  const observedAt = new Date()
  const { tx } = args
  const existing =
    args.held ?? (await readCommitChecks({ tx, repoFullName, headSha: args.headSha }))
  const byKey = new Map(existing.map((row) => [row.checkKey, row]))
  for (const check of args.checks) {
    const fields = writeOf(check)
    const held = byKey.get(check.checkKey)
    if (held !== undefined) {
      const heldCompleted = held.outcome !== ECheckOutcome.Running
      const heldNewer = newerThanHeld({ held, check })
      const staleRun = heldCompleted && (check.outcome === ECheckOutcome.Running || heldNewer)
      if (check.isRun ? staleRun : heldNewer) continue
      const heldFresh = observedAt.getTime() - held.updatedAt.getTime() < COMMIT_CHECK_TOUCH_MS
      if (heldFresh && heldMatchesWrite({ held, write: fields })) continue
    }
    await tx.orm.public.GithubCommitCheck.upsert({
      conflictOn: {
        repoFullName,
        headSha: args.headSha,
        checkKey: check.checkKey,
      },
      create: {
        repoFullName,
        headSha: args.headSha,
        checkKey: check.checkKey,
        ...fields,
      },
      update: fields,
    })
    byKey.set(check.checkKey, {
      checkKey: check.checkKey,
      ...fields,
      annotations: fields.annotations ?? held?.annotations ?? [],
      updatedAt: observedAt,
    })
  }

  return [...byKey.values()]
}

export function commitChecksTallyOf(rows: readonly CheckIdentityRow[]): ChecksCount {
  const latest = latestCheckAttempts({ attempts: checkIdentitiesOf(rows) })

  return checksTally(latest.map((attempt) => attempt.outcome))
}

export async function commitChecksTally(args: {
  tx: Tx
  repoFullName: string
  headSha: string
}): Promise<ChecksCount> {
  return commitChecksTallyOf(await readCommitChecks(args))
}

export async function pruneCommitChecks(args: { now: Date }): Promise<void> {
  const cutoff = new Date(args.now.getTime() - COMMIT_CHECK_RETENTION_MS)
  await db.execute(
    db.raw
      .sql`DELETE FROM "GithubCommitCheck" WHERE "updatedAt" < ${cutoff.toISOString()}::timestamptz`
      .affectedCount()
      .build(),
  )
}

export function restCommitChecksOf(args: {
  checkRuns: readonly CheckRunShape[]
  statuses: readonly CommitStatusShape[]
}): CommitCheckInput[] {
  const latestByContext = new Map<string, CommitStatusShape>()
  for (const status of args.statuses) {
    if (!latestByContext.has(status.context)) latestByContext.set(status.context, status)
  }
  return [
    ...args.checkRuns.map(checkRunInputOf),
    ...[...latestByContext.values()].map(commitStatusInputOf),
  ]
}
