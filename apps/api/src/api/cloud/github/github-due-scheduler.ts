import { and, db, or, type Row } from '@dltech/atlas-db'

export const CLAIM_BATCH = 200
export const CLAIM_LEASE_MS = 2 * 60 * 1_000

export const claimedTargets = (args: { now: Date; limit: number }) =>
  db.transaction(async (tx) => {
    const due = await tx.orm.public.GithubTrackingTarget.where((target) =>
      and(target.liveUntil.gt(args.now), target.nextDueAt.lte(args.now)),
    )
      .where((target) => or(target.leaseUntil.isNull(), target.leaseUntil.lt(args.now)))
      .orderBy((target) => target.nextDueAt.asc())
      .limit(args.limit)
      .forUpdate({ skipLocked: true })
      .all()
    if (due.length === 0) return []
    const leaseUntil = new Date(args.now.getTime() + CLAIM_LEASE_MS)
    await tx.orm.public.GithubTrackingTarget.where((target) =>
      target.id.in(due.map((row) => row.id)),
    ).updateAndCount({ leaseUntil })
    return due.map((row): Row<'GithubTrackingTarget'> => ({ ...row, leaseUntil }))
  })

export const releaseTarget = (args: {
  id: string
  attemptedAt: Date
  nextDueAt: Date
  failures: number
}): Promise<number> =>
  db.orm.public.GithubTrackingTarget.where({ id: args.id }).updateAndCount({
    attemptedAt: args.attemptedAt,
    nextDueAt: args.nextDueAt,
    failures: args.failures,
    leaseUntil: null,
  })
