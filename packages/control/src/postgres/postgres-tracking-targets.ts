import { and, type Tx } from '@dltech/atlas-db'

import type { TrackingTarget } from '../port'

const GITHUB_PREFIX = /^github\.com\//i

type Key = Pick<TrackingTarget, 'userId' | 'kind' | 'repoFullName' | 'branch' | 'prNumber'>

const keyOf = (params: TrackingTarget): Key => ({
  userId: params.userId,
  kind: params.kind,
  repoFullName: params.repoFullName.replace(GITHUB_PREFIX, '').toLowerCase(),
  branch: params.branch,
  prNumber: params.prNumber,
})

/**
 * A head target carries no PR number, and Postgres keeps nulls distinct in a unique index, so the
 * row is found and updated explicitly rather than through the unique key.
 */
export const upsertTrackingTargetIn = async (
  params: TrackingTarget & { tx: Tx },
): Promise<void> => {
  const key = keyOf(params)
  const liveUntil = new Date(params.liveUntil)
  const updated = await params.tx.orm.public.GithubTrackingTarget.where((target) =>
    and(
      target.userId.eq(key.userId),
      target.kind.eq(key.kind),
      target.repoFullName.eq(key.repoFullName),
      target.branch.eq(key.branch),
      key.prNumber === null ? target.prNumber.isNull() : target.prNumber.eq(key.prNumber),
    ),
  ).update({ liveUntil })
  if (updated !== null) return
  await params.tx.orm.public.GithubTrackingTarget.create({ ...key, liveUntil })
}
