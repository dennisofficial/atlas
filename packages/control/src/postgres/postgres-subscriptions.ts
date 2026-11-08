import type { Tx } from '@dltech/atlas-db'

import type { PrSubscriptionLease } from '../port'

const GITHUB_PREFIX = /^github\.com\//i

const rowOf = (params: PrSubscriptionLease) => ({
  userId: params.userId,
  repoFullName: params.repo.replace(GITHUB_PREFIX, '').toLowerCase(),
  branch: `#${params.number}`,
  threadId: params.threadId,
})

export const upsertPrSubscriptionLeaseIn = async (
  params: PrSubscriptionLease & { tx: Tx; expiresAt: string },
): Promise<void> => {
  const key = rowOf(params)
  const expiresAt = new Date(params.expiresAt)
  await params.tx.orm.public.GithubSubscription.upsert({
    conflictOn: key,
    create: { ...key, prNumber: params.number, pollBacked: true, expiresAt, liveUntil: expiresAt },
    update: { prNumber: params.number, expiresAt, liveUntil: expiresAt },
  })
}

export const deletePrSubscriptionLeaseIn = async (
  params: PrSubscriptionLease & { tx: Tx },
): Promise<boolean> => {
  const removed = await params.tx.orm.public.GithubSubscription.where(
    rowOf(params),
  ).deleteAndCount()
  return removed > 0
}
