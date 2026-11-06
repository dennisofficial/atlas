import {
  ECheckOutcome,
  FAILED_CHECK_LIMIT,
  latestAttempts,
  prFailedCheckAnnotationSchema,
} from '@dltech/atlas-core'
import { db, type Tx } from '@dltech/atlas-db'
import { z } from 'zod'
import { RUN_KEY_PREFIX, runOrderOfKey, SUITE_KEY_PREFIX } from './github-check-suites'
import { normalizedRepo } from './github-pr-identity'
import type { GithubPrCheckAnnotation, GithubPrFailedCheck } from './github-realtime.types'

type CheckRow = {
  checkKey: string
  name: string | null
  startedAt: string | null
  outcome: string
  conclusion?: string | null
  appSlug: string | null
  detailsUrl: string | null
  title: string | null
  summary: string | null
  annotations?: unknown
  sourceUpdatedAt: Date
}

const present = (value: string | null): string | undefined => (value === null ? undefined : value)

const annotationsOf = (value: unknown): GithubPrCheckAnnotation[] | undefined => {
  const parsed = z.array(prFailedCheckAnnotationSchema).safeParse(value)
  if (!parsed.success || parsed.data.length === 0) return undefined
  return parsed.data.map((annotation) => ({
    message: annotation.message,
    ...(annotation.path === undefined ? {} : { path: annotation.path }),
    ...(annotation.line === undefined ? {} : { line: annotation.line }),
    ...(annotation.title === undefined ? {} : { title: annotation.title }),
  }))
}

export function failedCheckOf(row: CheckRow): GithubPrFailedCheck {
  const runId = row.checkKey.startsWith(RUN_KEY_PREFIX)
    ? row.checkKey.slice(RUN_KEY_PREFIX.length)
    : undefined
  const check: GithubPrFailedCheck = { name: row.name ?? row.checkKey }
  const app = present(row.appSlug)
  const url = present(row.detailsUrl)
  const conclusion = present(row.conclusion ?? null)
  const title = present(row.title)
  const summary = present(row.summary)
  const annotations = annotationsOf(row.annotations)
  return {
    ...check,
    ...(app === undefined ? {} : { app }),
    ...(url === undefined ? {} : { url }),
    ...(runId === undefined ? {} : { checkRunId: runId }),
    ...(conclusion === undefined ? {} : { conclusion }),
    ...(title === undefined ? {} : { title }),
    ...(summary === undefined ? {} : { summary }),
    ...(annotations === undefined ? {} : { annotations }),
  }
}

export function failedChecksOfRows(rows: readonly CheckRow[]): GithubPrFailedCheck[] {
  const attempts = rows
    .filter((row) => !row.checkKey.startsWith(SUITE_KEY_PREFIX))
    .map((row) => ({
      row,
      name: row.name,
      order: runOrderOfKey(row.checkKey),
      outcome: row.outcome as ECheckOutcome,
    }))
  return latestAttempts(attempts)
    .filter((attempt) => attempt.outcome === ECheckOutcome.Failed)
    .map((attempt) => failedCheckOf(attempt.row))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, FAILED_CHECK_LIMIT)
}

export async function failedChecksOf(args: {
  tx: Tx | undefined
  repoFullName: string
  headSha: string
}): Promise<GithubPrFailedCheck[]> {
  const rows = await (args.tx ?? db).orm.public.GithubCommitCheck.where({
    repoFullName: normalizedRepo(args.repoFullName),
    headSha: args.headSha,
  }).all()
  return failedChecksOfRows(rows)
}
