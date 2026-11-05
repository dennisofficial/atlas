import {
  ECheckOutcome,
  FAILED_CHECK_ANNOTATION_LIMIT,
  FAILED_CHECK_ANNOTATION_MESSAGE_LIMIT,
} from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import type { CommitCheckInput } from './github-commit-checks'
import { RUN_KEY_PREFIX } from './github-check-suites'
import { normalizedRepo } from './github-pr-identity'
import type { GithubPrCheckAnnotation } from './github-realtime.types'

export type RawCheckAnnotation = {
  path?: string | null
  start_line?: number | null
  annotation_level?: string | null
  title?: string | null
  message?: string | null
}

export type FetchAnnotations = (args: {
  repoFullName: string
  checkRunId: number
}) => Promise<readonly RawCheckAnnotation[] | null>

const GENERIC_EXIT = /^Process completed with exit code \d+\.?$/

const clipped = (message: string): string =>
  message.length <= FAILED_CHECK_ANNOTATION_MESSAGE_LIMIT
    ? message
    : `${message.slice(0, FAILED_CHECK_ANNOTATION_MESSAGE_LIMIT - 1)}…`

export function failureAnnotationsOf(
  raw: readonly RawCheckAnnotation[],
): GithubPrCheckAnnotation[] {
  const kept: GithubPrCheckAnnotation[] = []
  for (const annotation of raw) {
    if (annotation.annotation_level !== 'failure') continue
    const message = annotation.message?.trim() ?? ''
    if (message === '' || GENERIC_EXIT.test(message)) continue
    const title = annotation.title?.trim() ?? ''
    kept.push({
      message: clipped(message),
      ...(annotation.path ? { path: annotation.path } : {}),
      ...(annotation.path && annotation.start_line ? { line: annotation.start_line } : {}),
      ...(title === '' ? {} : { title }),
    })
    if (kept.length === FAILED_CHECK_ANNOTATION_LIMIT) break
  }
  return kept
}

const wantsAnnotations = (check: CommitCheckInput): boolean =>
  check.isRun && check.outcome === ECheckOutcome.Failed && (check.annotationsCount ?? 0) > 0

async function annotationsHeld(args: {
  repoFullName: string
  headSha: string
  checkKey: string
}): Promise<boolean> {
  const row = await db.orm.public.GithubCommitCheck.where({
    repoFullName: args.repoFullName,
    headSha: args.headSha,
    checkKey: args.checkKey,
  }).first()
  return row?.annotations != null
}

export class CheckAnnotationFetcher {
  private readonly inflight = new Map<string, Promise<GithubPrCheckAnnotation[] | undefined>>()

  constructor(private readonly fetchAnnotations: FetchAnnotations) {}

  async attach(args: {
    repoFullName: string
    headSha: string
    check: CommitCheckInput
  }): Promise<CommitCheckInput> {
    const { check } = args
    if (!wantsAnnotations(check)) return check
    const repoFullName = normalizedRepo(args.repoFullName)
    const key = `${repoFullName}@${args.headSha}#${check.checkKey}`
    const pending = this.inflight.get(key)
    if (pending !== undefined) return withAnnotations({ check, annotations: await pending })
    const fetched = this.fetchOnce({ repoFullName, headSha: args.headSha, check })
    this.inflight.set(key, fetched)
    try {
      return withAnnotations({ check, annotations: await fetched })
    } finally {
      this.inflight.delete(key)
    }
  }

  private async fetchOnce(args: {
    repoFullName: string
    headSha: string
    check: CommitCheckInput
  }): Promise<GithubPrCheckAnnotation[] | undefined> {
    if (await annotationsHeld({ ...args, checkKey: args.check.checkKey })) return undefined
    try {
      const raw = await this.fetchAnnotations({
        repoFullName: args.repoFullName,
        checkRunId: Number(args.check.checkKey.slice(RUN_KEY_PREFIX.length)),
      })
      return raw === null ? undefined : failureAnnotationsOf(raw)
    } catch {
      return undefined
    }
  }
}

const withAnnotations = (args: {
  check: CommitCheckInput
  annotations: GithubPrCheckAnnotation[] | undefined
}): CommitCheckInput =>
  args.annotations === undefined ? args.check : { ...args.check, annotations: args.annotations }
