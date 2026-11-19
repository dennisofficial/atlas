import { randomUUID } from 'node:crypto'
import { and, db, or, type Row, type Tx } from '@dltech/atlas-db'

import { isGithubBudgetParked } from './github-request-budget'
import { GITHUB_RATE_LIMIT_RETRY_MS, GithubUserReadFailed } from './github-user-http'

export const PR_OUTBOX_LEASE_MS = 60 * 1_000
/** How little lease a claim must have left before its owner re-verifies it against the database. */
export const PR_OUTBOX_RENEW_WITHIN_MS = PR_OUTBOX_LEASE_MS / 2
export const PR_OUTBOX_MAX_ATTEMPTS = 5
export const PR_OUTBOX_PARK_MS = 5_000
export const PR_OUTBOX_PARK_EXPIRE_MS = 60 * 60 * 1_000
const BACKOFF_BASE_MS = 5_000
const BACKOFF_CAP_MS = 10 * 60 * 1_000
const parkedTooLongError = `parked past ${PR_OUTBOX_PARK_EXPIRE_MS} ms without a token or a successful read`

const parkExpireCutoff = (now: Date) => new Date(now.getTime() - PR_OUTBOX_PARK_EXPIRE_MS)

export type PrOutboxClaim = {
  token: string
  /** When the lease this claim granted runs out, so a dispatcher can tell a live lease from one it must re-check. */
  leaseUntil: Date
  rows: readonly Row<'GithubPrOutbox'>[]
  deadLettered: readonly Row<'GithubPrOutbox'>[]
}

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

export const prOutboxBackoffMs = (attempts: number): number =>
  Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_CAP_MS)

async function expireStaleParkedRows(args: {
  tx: Tx
  now: Date
  ids: readonly string[] | undefined
  limit: number
}): Promise<Row<'GithubPrOutbox'>[]> {
  const ids = args.ids
  const cutoff = parkExpireCutoff(args.now)
  const parked = args.tx.orm.public.GithubPrOutbox.where({
    dispatchedAt: null,
    deadLetteredAt: null,
  }).where((row) =>
    and(
      row.parkedSince.lte(cutoff),
      row.nextAttemptAt.isNotNull(),
      row.nextAttemptAt.lte(args.now),
      or(row.leaseUntil.isNull(), row.leaseUntil.lt(args.now)),
    ),
  )
  const scoped = ids === undefined ? parked : parked.where((row) => row.id.in([...ids]))
  const rows = await scoped.limit(args.limit).forUpdate({ skipLocked: true }).all()
  if (rows.length === 0) return []
  await args.tx.orm.public.GithubPrOutbox.where((row) =>
    row.id.in(rows.map((held) => held.id)),
  ).updateAndCount({
    leaseUntil: null,
    leaseOwner: null,
    nextAttemptAt: null,
    parkedSince: null,
    deadLetteredAt: args.now,
    lastError: parkedTooLongError,
  })

  return rows.map((row) => ({
    ...row,
    nextAttemptAt: null,
    parkedSince: null,
    deadLetteredAt: args.now,
    lastError: parkedTooLongError,
  }))
}

async function duePrOutboxRows(args: {
  tx: Tx
  now: Date
  ids: readonly string[] | undefined
  limit: number
  freshOnly: boolean
}): Promise<Row<'GithubPrOutbox'>[]> {
  const ids = args.ids
  const expiredBefore = parkExpireCutoff(args.now)
  const pending = args.tx.orm.public.GithubPrOutbox.where({
    dispatchedAt: null,
    deadLetteredAt: null,
  }).where((row) =>
    and(
      or(row.leaseUntil.isNull(), row.leaseUntil.lt(args.now)),
      args.freshOnly ? row.nextAttemptAt.isNull() : row.nextAttemptAt.lte(args.now),
      or(row.parkedSince.isNull(), row.parkedSince.gt(expiredBefore)),
    ),
  )
  const scoped = ids === undefined ? pending : pending.where((row) => row.id.in([...ids]))

  return args.freshOnly
    ? scoped
        .orderBy((row) => row.createdAt.asc())
        .limit(args.limit)
        .forUpdate({ skipLocked: true })
        .all()
    : scoped
        .orderBy((row) => row.nextAttemptAt.asc())
        .limit(args.limit)
        .forUpdate({ skipLocked: true })
        .all()
}

export function claimPrOutboxRows(args: {
  now: Date
  limit: number
  ids?: readonly string[]
}): Promise<PrOutboxClaim> {
  const ids = args.ids
  const token = `outbox_${randomUUID()}`
  const leaseUntil = new Date(args.now.getTime() + PR_OUTBOX_LEASE_MS)
  if (args.limit <= 0 || ids?.length === 0) {
    return Promise.resolve({ token, leaseUntil, rows: [], deadLettered: [] })
  }
  return db.transaction(async (tx) => {
    const stale = await expireStaleParkedRows({ tx, now: args.now, ids, limit: args.limit })
    const fresh = await duePrOutboxRows({
      tx,
      now: args.now,
      ids,
      limit: args.limit,
      freshOnly: true,
    })
    const retried =
      fresh.length >= args.limit
        ? []
        : await duePrOutboxRows({
            tx,
            now: args.now,
            ids,
            limit: args.limit - fresh.length,
            freshOnly: false,
          })
    const due = [...fresh, ...retried]
    const exhausted = [...stale, ...due.filter((row) => row.attempts >= PR_OUTBOX_MAX_ATTEMPTS)]
    if (exhausted.length > 0) {
      await tx.orm.public.GithubPrOutbox.where((row) =>
        row.id.in(exhausted.map((held) => held.id)),
      ).updateAndCount({
        leaseUntil: null,
        leaseOwner: null,
        nextAttemptAt: null,
        parkedSince: null,
        deadLetteredAt: args.now,
      })
    }
    const rows = due.filter((row) => row.attempts < PR_OUTBOX_MAX_ATTEMPTS)
    if (rows.length === 0) return { token, leaseUntil, rows: [], deadLettered: exhausted }
    await tx.orm.public.GithubPrOutbox.where((row) =>
      row.id.in(rows.map((held) => held.id)),
    ).updateAndCount({ leaseUntil, leaseOwner: token })

    return {
      token,
      leaseUntil,
      rows: rows.map((row) => ({ ...row, leaseUntil, leaseOwner: token })),
      deadLettered: exhausted,
    }
  })
}

export async function renewPrOutboxLease(args: {
  id: string
  token: string
  now: Date
}): Promise<boolean> {
  const renewed = await db.orm.public.GithubPrOutbox.where({
    id: args.id,
    dispatchedAt: null,
    deadLetteredAt: null,
  })
    .where((row) => row.leaseOwner.eq(args.token))
    .updateAndCount({ leaseUntil: new Date(args.now.getTime() + PR_OUTBOX_LEASE_MS) })

  return renewed > 0
}

/**
 * The fence a dispatcher passes before it runs an effect. No other dispatcher can take a row whose
 * lease has not run out, so while more than the renewal window is left the claim is provably still
 * ours and the check costs nothing; inside the window the lease is renewed, which both extends it
 * over the effect and re-confirms the token still owns the row. Renewing every row on claim instead
 * spent a single-row update per effect on a lease that had just been granted.
 */
export async function holdsPrOutboxLease(args: {
  id: string
  token: string
  leaseUntil: Date
  now: Date
}): Promise<boolean> {
  if (args.leaseUntil.getTime() - args.now.getTime() > PR_OUTBOX_RENEW_WITHIN_MS) return true

  return renewPrOutboxLease({ id: args.id, token: args.token, now: args.now })
}

export async function completePrOutboxRow(args: {
  id: string
  token: string
  now: Date
}): Promise<boolean> {
  const completed = await db.orm.public.GithubPrOutbox.where({
    id: args.id,
    dispatchedAt: null,
    deadLetteredAt: null,
  })
    .where((row) => row.leaseOwner.eq(args.token))
    .updateAndCount({
      dispatchedAt: args.now,
      leaseUntil: null,
      leaseOwner: null,
      parkedSince: null,
      lastError: null,
    })

  return completed > 0
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
