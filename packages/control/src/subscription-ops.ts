import type { ESubscriptionActor, JsonValue } from '@dltech/atlas-core'
import type { SessionSubscription } from '@dltech/atlas-protocol'

import type { ControlSessionRow, ControlTx, SubscriptionDraft } from './port'
import { repoFullNameOf } from './repo-name'
import { subscriptionSubjectKey } from './port'
import { recordOf, subscriptionOf, tracked, type SubscriptionLeaseInput } from './subscription-rows'

const WRITE_ATTEMPTS = 3

export type SubscribeResult = {
  subscription: SessionSubscription
  existed: boolean
  updated: boolean
}

const sameEvents = (left: readonly string[], right: readonly string[]): boolean => {
  const a = [...new Set(left)].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((event, index) => event === b[index])
}

export type SubscribeArgs = {
  tx: ControlTx
  session: ControlSessionRow
  threadId: string
  provider: string
  target: JsonValue
  label: string
  events?: readonly string[] | undefined
  lease: SubscriptionLeaseInput
  by: ESubscriptionActor
  at: string
}

export const subscribeIn = async (args: SubscribeArgs): Promise<SubscribeResult> => {
  const key = {
    userId: args.session.userId,
    repoFullName: repoFullNameOf(args.lease.repo),
    branch: subscriptionSubjectKey(args.lease.subject),
    threadId: args.threadId,
  }
  await args.tx.lockSubscriptionKey(key)
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const held = await args.tx.findSubscription(key)
    const events = [...new Set(args.events ?? held?.events ?? [])]
    if (held === undefined) {
      const draft: SubscriptionDraft = {
        sessionId: args.session.sessionId,
        provider: args.provider,
        kind: args.lease.subject.kind,
        prNumber: args.lease.subject.kind === 'pull-request' ? args.lease.subject.number : null,
        target: args.target,
        label: args.label,
        createdBy: args.by,
        events,
        expiresAt: null,
        deadline: null,
        createdAt: args.at,
        ...key,
      }
      const written = await args.tx.insertSubscriptionRow(draft)
      if (!written.inserted) continue
      await tracked({ tx: args.tx, session: args.session, lease: args.lease })
      await recordOf({
        tx: args.tx,
        session: args.session,
        threadId: args.threadId,
        event: {
          type: 'subscription-created',
          subscriptionId: written.row.subscriptionId,
          provider: args.provider,
          target: args.target,
          label: args.label,
          createdBy: args.by,
          ...(events.length === 0 ? {} : { events }),
        },
        at: args.at,
      })
      return { subscription: subscriptionOf(written.row), existed: false, updated: false }
    }
    if (sameEvents(held.events, events) && held.expiresAt === null && held.deadline === null) {
      return { subscription: subscriptionOf(held), existed: true, updated: false }
    }
    const updated = await args.tx.updateSubscriptionRow({
      subscriptionId: held.subscriptionId,
      provider: args.provider,
      target: args.target,
      label: args.label,
      events,
      expiresAt: null,
      deadline: null,
    })
    if (!updated) continue
    await recordOf({
      tx: args.tx,
      session: args.session,
      threadId: held.threadId,
      event: {
        type: 'subscription-created',
        subscriptionId: held.subscriptionId,
        provider: args.provider,
        target: args.target,
        label: args.label,
        createdBy: args.by,
        ...(events.length === 0 ? {} : { events }),
      },
      at: args.at,
    })
    return {
      subscription: subscriptionOf({
        ...held,
        provider: args.provider,
        target: args.target,
        label: args.label,
        events,
        expiresAt: null,
        deadline: null,
      }),
      existed: true,
      updated: true,
    }
  }
  throw new Error(`the subscription for ${key.repoFullName}${key.branch} was not written`)
}

export const listSubscriptionsIn = async (args: {
  tx: ControlTx
  sessionId: string
  threadId?: string | undefined
}): Promise<SessionSubscription[]> => {
  const rows = await args.tx.readSessionSubscriptionRows(args.sessionId)
  return rows
    .filter((row) => args.threadId === undefined || row.threadId === args.threadId)
    .map(subscriptionOf)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    )
}
