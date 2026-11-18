import type { Tx } from '@dltech/atlas-db'

import type { TrackingTarget, TrackingTargetKind } from '../port'

const GITHUB_PREFIX = /^github\.com\//i

type Key = {
  userId: string
  kind: TrackingTargetKind
  repoFullName: string
  branch: string
  prNumber: number
}

const keyOf = (params: TrackingTarget): Key => ({
  userId: params.userId,
  kind: params.kind,
  repoFullName: params.repoFullName.replace(GITHUB_PREFIX, '').toLowerCase(),
  branch: params.branch,
  prNumber: params.prNumber ?? 0,
})

export const upsertTrackingTargetIn = async (
  params: TrackingTarget & { tx: Tx },
): Promise<void> => {
  const key = keyOf(params)
  const liveUntil = new Date(params.liveUntil)
  await params.tx.orm.public.GithubTrackingTarget.upsert({
    conflictOn: {
      userId: key.userId,
      kind: key.kind,
      repoFullName: key.repoFullName,
      branch: key.branch,
      prNumber: key.prNumber,
    },
    create: { ...key, liveUntil },
    update: { liveUntil },
  })
}
