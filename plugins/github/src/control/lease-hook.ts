import type { AppendHook, ControlTx } from '@dltech/atlas-control'
import type { V2Event } from '@dltech/atlas-core'

import { GITHUB_PROVIDER, targetOf } from '../core'

export const LEASE_TTL_MS = 5 * 60_000

type CreatedBody = { subscriptionId?: unknown; provider?: unknown; target?: unknown }

const createdTarget = (args: { canonical: string; subscriptionId: string }) => {
  const body: CreatedBody = JSON.parse(args.canonical)
  if (body.subscriptionId !== args.subscriptionId || body.provider !== GITHUB_PROVIDER) return null
  return targetOf(body.target)
}

const endedTarget = async (args: {
  tx: ControlTx
  event: V2Event & { subscriptionId: string }
}) => {
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
    const target = createdTarget({
      canonical: row.canonical,
      subscriptionId: args.event.subscriptionId,
    })
    if (target !== null) return target
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
      if (event.provider !== GITHUB_PROVIDER) return
      const target = targetOf(event.target)
      if (target === null) return
      await tx.upsertPrSubscriptionLease({
        userId: session.userId,
        threadId: event.threadId,
        ...target,
        expiresAt: new Date(Date.parse(event.at) + LEASE_TTL_MS).toISOString(),
      })
      return
    }
    if (event.type !== 'subscription-ended') return
    const target = await endedTarget({ tx, event })
    if (target === null) return
    await tx.deletePrSubscriptionLease({
      userId: session.userId,
      threadId: event.threadId,
      ...target,
    })
  },
}
