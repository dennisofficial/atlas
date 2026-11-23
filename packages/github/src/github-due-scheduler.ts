import { randomUUID } from 'node:crypto'
import { and, db, or, type Row } from '@dltech/atlas-db'
import { ETargetKind, ETargetOutcome, ETrackingTransport, nextDueOf } from '@dltech/atlas-core'

export const CLAIM_BATCH = 200
export const CLAIM_LEASE_MS = 2 * 60 * 1_000

export type ClaimedTarget = Row<'GithubTrackingTarget'> & { leaseToken: string }

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
    const leaseToken = randomUUID()
    await tx.orm.public.GithubTrackingTarget.where((target) =>
      target.id.in(due.map((row) => row.id)),
    ).updateAndCount({ leaseUntil, leaseToken })
    return due.map((row): ClaimedTarget => ({ ...row, leaseUntil, leaseToken }))
  })

export const renewClaim = (args: { id: string; leaseToken: string; now: Date }): Promise<number> =>
  db.orm.public.GithubTrackingTarget.where({
    id: args.id,
    leaseToken: args.leaseToken,
  }).updateAndCount({ leaseUntil: new Date(args.now.getTime() + CLAIM_LEASE_MS) })

export const releaseTarget = (args: {
  id: string
  leaseToken: string
  attemptedAt: Date
  nextDueAt: Date
  failures: number
}): Promise<number> =>
  db.orm.public.GithubTrackingTarget.where({
    id: args.id,
    leaseToken: args.leaseToken,
  }).updateAndCount({
    attemptedAt: args.attemptedAt,
    nextDueAt: args.nextDueAt,
    failures: args.failures,
    leaseUntil: null,
    leaseToken: null,
  })

export const settleTarget = (args: {
  target: ClaimedTarget
  now: Date
  transport: ETrackingTransport
  outcome: ETargetOutcome
  retryAtMs?: number | undefined
  mergedAtMs?: number | undefined
}): Promise<number> => {
  const due = nextDueOf({
    nowMs: args.now.getTime(),
    kind: args.target.kind === 'head' ? ETargetKind.Head : ETargetKind.PullRequest,
    transport: args.transport,
    lookedUp: args.target.lookedUpAt !== null,
    outcome: args.outcome,
    failures: args.target.failures,
    retryAtMs: args.retryAtMs,
    liveUntilMs: args.target.liveUntil.getTime(),
    mergedAtMs: args.mergedAtMs,
  })
  return releaseTarget({
    id: args.target.id,
    leaseToken: args.target.leaseToken,
    attemptedAt: args.now,
    nextDueAt: new Date(due.nextDueAt),
    failures: due.failures,
  })
}

export const markRepoTargetsDue = (args: { repoFullName: string; now: Date }): Promise<number> =>
  db.orm.public.GithubTrackingTarget.where((target) =>
    target.repoFullName.ilike(args.repoFullName.toLowerCase()),
  ).updateAndCount({ nextDueAt: args.now })

export const markReposTargetsDue = (args: {
  repoFullNames: readonly string[]
  now: Date
}): Promise<number> => {
  const repoFullNames = [...new Set(args.repoFullNames.map((repo) => repo.toLowerCase()))]
  if (repoFullNames.length === 0) return Promise.resolve(0)
  return db.orm.public.GithubTrackingTarget.where((target) =>
    target.repoFullName.in(repoFullNames),
  ).updateAndCount({ nextDueAt: args.now })
}
