import type { Tx } from '@dltech/atlas-db'

import type { ReleasePullRequestTrackingParams, TrackingTarget, TrackingTargetKind } from '../port'
import { expiryInstantOf } from './no-expiry'

const GITHUB_PREFIX = /^github\.com\//i

type Key = {
  userId: string
  kind: TrackingTargetKind
  repoFullName: string
  branch: string
  prNumber: number
}

const repoFullNameOf = (repoFullName: string): string =>
  repoFullName.replace(GITHUB_PREFIX, '').toLowerCase()

const keyOf = (params: TrackingTarget): Key => ({
  userId: params.userId,
  kind: params.kind,
  repoFullName: repoFullNameOf(params.repoFullName),
  branch: params.branch,
  prNumber: params.prNumber ?? 0,
})

export const upsertTrackingTargetIn = async (
  params: TrackingTarget & { tx: Tx },
): Promise<void> => {
  const key = keyOf(params)
  const liveUntil = expiryInstantOf(params.liveUntil)
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

export const releasePullRequestTrackingIn = async (
  params: ReleasePullRequestTrackingParams & { tx: Tx },
): Promise<void> => {
  const repoFullName = repoFullNameOf(params.repoFullName)
  await params.tx.execute(
    params.tx.raw.sql`
    UPDATE "public"."GithubTrackingTarget"
    SET "liveUntil" = ${params.at}::timestamptz
    WHERE "userId" = ${params.userId}
      AND "kind" = 'pull-request'
      AND "repoFullName" = ${repoFullName}
      AND "branch" = ''
      AND "prNumber" = ${params.prNumber}::int
      AND NOT EXISTS (
        SELECT 1 FROM "public"."GithubSubscription"
        WHERE "userId" = ${params.userId}
          AND "repoFullName" = ${repoFullName}
          AND "prNumber" = ${params.prNumber}::int
          AND "liveUntil" > ${params.at}::timestamptz
      )
  `
      .affectedCount()
      .build(),
  )
}
