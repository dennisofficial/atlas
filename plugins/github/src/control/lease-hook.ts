import type { AppendHook, ControlTx } from '@dltech/atlas-control'
import type { V2Event } from '@dltech/atlas-core'

import { GITHUB_PROVIDER, targetOf } from '../core'

export const DEFAULT_SUBSCRIPTION_TTL_MS = 24 * 60 * 60_000

type CreatedBody = {
  subscriptionId?: unknown
  provider?: unknown
  target?: unknown
}

const expiryOf = (event: { at: string; expiresAt?: string | undefined }): string => {
  const declared = event.expiresAt === undefined ? Number.NaN : Date.parse(event.expiresAt)
  if (!Number.isNaN(declared)) return new Date(declared).toISOString()
  return new Date(Date.parse(event.at) + DEFAULT_SUBSCRIPTION_TTL_MS).toISOString()
}

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
        expiresAt: expiryOf(event),
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
