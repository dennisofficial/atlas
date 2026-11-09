import type { AppendHook, ControlTx } from '@dltech/atlas-control'
import type { V2Event } from '@dltech/atlas-core'

import { GITHUB_PROVIDER, GITHUB_RUN_PROVIDER, runSelectorOf, runTargetOf, targetOf } from '../core'

export const DEFAULT_SUBSCRIPTION_TTL_MS = 24 * 60 * 60_000

type CreatedBody = {
  subscriptionId?: unknown
  provider?: unknown
  target?: unknown
}

type LeaseOf = {
  repo: string
  subject: { kind: 'pull-request'; number: number } | { kind: 'workflow-run'; selector: string }
}

const expiryOf = (event: { at: string; expiresAt?: string | undefined }): string => {
  const declared = event.expiresAt === undefined ? Number.NaN : Date.parse(event.expiresAt)
  if (!Number.isNaN(declared)) return new Date(declared).toISOString()
  return new Date(Date.parse(event.at) + DEFAULT_SUBSCRIPTION_TTL_MS).toISOString()
}

const leaseOf = (body: CreatedBody): LeaseOf | null => {
  if (body.provider === GITHUB_PROVIDER) {
    const target = targetOf(body.target)
    return target === null
      ? null
      : { repo: target.repo, subject: { kind: 'pull-request', number: target.number } }
  }
  if (body.provider !== GITHUB_RUN_PROVIDER) return null
  const target = runTargetOf(body.target)
  return target === null
    ? null
    : { repo: target.repo, subject: { kind: 'workflow-run', selector: runSelectorOf(target) } }
}

const createdLease = (args: { canonical: string; subscriptionId: string }): LeaseOf | null => {
  const body: CreatedBody = JSON.parse(args.canonical)
  if (body.subscriptionId !== args.subscriptionId) return null
  return leaseOf(body)
}

const endedLease = async (args: {
  tx: ControlTx
  event: V2Event & { subscriptionId: string }
}): Promise<LeaseOf | null> => {
  const head = await args.tx.readThread(args.event.threadId)
  if (head === undefined) return null
  const rows = await args.tx.readEvents({
    threadId: args.event.threadId,
    afterSeq: 0,
    throughSeq: head.headSeq,
    limit: 10_000,
    onlyTypes: ['subscription-created'],
  })
  for (const row of rows) {
    const lease = createdLease({
      canonical: row.canonical,
      subscriptionId: args.event.subscriptionId,
    })
    if (lease !== null) return lease
  }
  return null
}

export const subscriptionLeaseHook: AppendHook = {
  name: 'github-subscription-lease',
  appliesTo: (event) =>
    event.type === 'subscription-created' || event.type === 'subscription-ended',
  handle: async ({ tx, sessionId, event }) => {
    const session = await tx.readSession({ sessionId })
    if (session === undefined) return
    if (event.type === 'subscription-created') {
      if (event.provider !== GITHUB_PROVIDER && event.provider !== GITHUB_RUN_PROVIDER) return
      const lease = leaseOf({ provider: event.provider, target: event.target })
      if (lease === null) return
      await tx.upsertSubscriptionLease({
        userId: session.userId,
        threadId: event.threadId,
        repo: lease.repo,
        subject: lease.subject,
        expiresAt: expiryOf(event),
      })
      return
    }
    if (event.type !== 'subscription-ended') return
    const lease = await endedLease({ tx, event })
    if (lease === null) return
    await tx.deleteSubscriptionLease({
      userId: session.userId,
      threadId: event.threadId,
      repo: lease.repo,
      subject: lease.subject,
    })
  },
}
