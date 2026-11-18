import { randomUUID } from 'node:crypto'
import { and, db, or, type Row } from '@dltech/atlas-db'

export const PR_OUTBOX_LEASE_MS = 60 * 1_000
export const PR_OUTBOX_MAX_ATTEMPTS = 5
const BACKOFF_BASE_MS = 5_000
const BACKOFF_CAP_MS = 10 * 60 * 1_000

export type PrOutboxClaim = {
  rows: readonly Row<'GithubPrOutbox'>[]
  deadLettered: readonly Row<'GithubPrOutbox'>[]
}

export type PrOutboxFailure = {
  row: Row<'GithubPrOutbox'>
  owner: string
  failure: unknown
  now: Date
}

export type PrOutboxFailureRecord = { attempts: number; deadLettered: boolean; lastError: string }

export const prOutboxOwnerOf = (): string => `outbox_${randomUUID()}`

export const prOutboxBackoffMs = (attempts: number): number =>
  Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_CAP_MS)

export function claimPrOutboxRows(args: {
  now: Date
  owner: string
  limit: number
  ids?: readonly string[]
}): Promise<PrOutboxClaim> {
  const ids = args.ids
  if (args.limit <= 0 || ids?.length === 0) {
    return Promise.resolve({ rows: [], deadLettered: [] })
  }
  return db.transaction(async (tx) => {
    const pending = tx.orm.public.GithubPrOutbox.where({
      dispatchedAt: null,
      deadLetteredAt: null,
    }).where((row) =>
      and(
        or(row.leaseUntil.isNull(), row.leaseUntil.lt(args.now)),
        or(row.nextAttemptAt.isNull(), row.nextAttemptAt.lte(args.now)),
      ),
    )
    const scoped = ids === undefined ? pending : pending.where((row) => row.id.in([...ids]))
    const due = await scoped
      .orderBy((row) => row.createdAt.asc())
      .limit(args.limit)
      .forUpdate({ skipLocked: true })
      .all()
    const exhausted = due.filter((row) => row.attempts >= PR_OUTBOX_MAX_ATTEMPTS)
    if (exhausted.length > 0) {
      await tx.orm.public.GithubPrOutbox.where((row) =>
        row.id.in(exhausted.map((held) => held.id)),
      ).updateAndCount({
        leaseUntil: null,
        leaseOwner: null,
        nextAttemptAt: null,
        deadLetteredAt: args.now,
      })
    }
    const rows = due.filter((row) => row.attempts < PR_OUTBOX_MAX_ATTEMPTS)
    if (rows.length === 0) return { rows: [], deadLettered: exhausted }
    const leaseUntil = new Date(args.now.getTime() + PR_OUTBOX_LEASE_MS)
    await tx.orm.public.GithubPrOutbox.where((row) =>
      row.id.in(rows.map((held) => held.id)),
    ).updateAndCount({ leaseUntil, leaseOwner: args.owner })

    return {
      rows: rows.map((row) => ({ ...row, leaseUntil, leaseOwner: args.owner })),
      deadLettered: exhausted,
    }
  })
}

export async function completePrOutboxRow(args: {
  id: string
  owner: string
  now: Date
}): Promise<boolean> {
  const completed = await db.orm.public.GithubPrOutbox.where({ id: args.id })
    .where((row) => row.leaseOwner.eq(args.owner))
    .updateAndCount({
      dispatchedAt: args.now,
      leaseUntil: null,
      leaseOwner: null,
      lastError: null,
    })

  return completed > 0
}

export async function failPrOutboxRow(args: PrOutboxFailure): Promise<PrOutboxFailureRecord> {
  const attempts = args.row.attempts + 1
  const deadLettered = attempts >= PR_OUTBOX_MAX_ATTEMPTS
  const lastError = String(args.failure).slice(0, 1000)
  await db.orm.public.GithubPrOutbox.where({ id: args.row.id })
    .where((row) => row.leaseOwner.eq(args.owner))
    .updateAndCount({
      attempts,
      lastError,
      leaseUntil: null,
      leaseOwner: null,
      nextAttemptAt: deadLettered
        ? null
        : new Date(args.now.getTime() + prOutboxBackoffMs(attempts)),
      deadLetteredAt: deadLettered ? args.now : null,
    })

  return { attempts, deadLettered, lastError }
}
