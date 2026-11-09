import type { Tx } from '@dltech/atlas-db'

import { subscriptionSubjectKey, type SubscriptionLease } from '../port'

const GITHUB_PREFIX = /^github\.com\//i

const rowOf = (params: SubscriptionLease) => ({
  userId: params.userId,
  repoFullName: params.repo.replace(GITHUB_PREFIX, '').toLowerCase(),
  branch: subscriptionSubjectKey(params.subject),
  threadId: params.threadId,
})

const prNumberOf = (params: SubscriptionLease): number | null =>
  params.subject.kind === 'pull-request' ? params.subject.number : null

export const upsertSubscriptionLeaseIn = async (
  params: SubscriptionLease & { tx: Tx; expiresAt: string },
): Promise<void> => {
  const key = rowOf(params)
  const prNumber = prNumberOf(params)
  const expiresAt = new Date(params.expiresAt)
  await params.tx.orm.public.GithubSubscription.upsert({
    conflictOn: key,
    create: {
      ...key,
      kind: params.subject.kind,
      prNumber,
      pollBacked: true,
      expiresAt,
      liveUntil: expiresAt,
    },
    update: { kind: params.subject.kind, prNumber, expiresAt, liveUntil: expiresAt },
  })
}

export const deleteSubscriptionLeaseIn = async (
  params: SubscriptionLease & { tx: Tx },
): Promise<boolean> => {
  const removed = await params.tx.orm.public.GithubSubscription.where(
    rowOf(params),
  ).deleteAndCount()
  return removed > 0
}
