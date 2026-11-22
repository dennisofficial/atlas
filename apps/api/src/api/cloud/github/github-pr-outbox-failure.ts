import { db, type Row } from '@dltech/atlas-db'
import {
  PR_OUTBOX_MAX_ATTEMPTS,
  PR_OUTBOX_PARK_MS,
  prOutboxBackoffMs,
} from './github-pr-outbox-lease'
import { isGithubBudgetParked } from './github-request-budget'
import { GITHUB_RATE_LIMIT_RETRY_MS, GithubUserReadFailed } from './github-user-http'

export type PrOutboxFailure = {
  row: Row<'GithubPrOutbox'>
  token: string
  failure: unknown
  now: Date
}

export type PrOutboxFailureRecord = {
  attempts: number
  deadLettered: boolean
  parked: boolean
  lastError: string
}

const parkUntilOf = (args: { failure: unknown; now: Date }): Date | undefined => {
  if (args.failure instanceof GithubUserReadFailed && args.failure.rateLimited) {
    const retryMs = Math.max(
      args.failure.retryAfterMs ?? GITHUB_RATE_LIMIT_RETRY_MS,
      PR_OUTBOX_PARK_MS,
    )

    return new Date(args.now.getTime() + retryMs)
  }
  if (!isGithubBudgetParked(args.failure)) return undefined
  const until = (args.failure as { until?: unknown }).until
  if (typeof until === 'number' && until > args.now.getTime()) return new Date(until)

  return new Date(args.now.getTime() + PR_OUTBOX_PARK_MS)
}

export async function failPrOutboxRow(args: PrOutboxFailure): Promise<PrOutboxFailureRecord> {
  const lastError = String(args.failure).slice(0, 1000)
  const parkUntil = parkUntilOf({ failure: args.failure, now: args.now })
  if (parkUntil !== undefined) {
    await db.orm.public.GithubPrOutbox.where({ id: args.row.id })
      .where((row) => row.leaseOwner.eq(args.token))
      .updateAndCount({
        lastError,
        leaseUntil: null,
        leaseOwner: null,
        nextAttemptAt: parkUntil,
        parkedSince: args.row.parkedSince ?? args.now,
      })

    return { attempts: args.row.attempts, deadLettered: false, parked: true, lastError }
  }
  const attempts = args.row.attempts + 1
  const deadLettered = attempts >= PR_OUTBOX_MAX_ATTEMPTS
  await db.orm.public.GithubPrOutbox.where({ id: args.row.id })
    .where((row) => row.leaseOwner.eq(args.token))
    .updateAndCount({
      attempts,
      lastError,
      leaseUntil: null,
      leaseOwner: null,
      parkedSince: null,
      nextAttemptAt: deadLettered
        ? null
        : new Date(args.now.getTime() + prOutboxBackoffMs(attempts)),
      deadLetteredAt: deadLettered ? args.now : null,
    })

  return { attempts, deadLettered, parked: false, lastError }
}
