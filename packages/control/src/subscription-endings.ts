import type { ESubscriptionActor, ESubscriptionEnd } from '@dltech/atlas-core'

import type { ControlSessionRow, ControlTx, SubscriptionRow } from './port'
import { recordOf } from './subscription-rows'

const releasePullRequestOf = async (args: {
  tx: ControlTx
  row: SubscriptionRow | undefined
  at: string
}): Promise<void> => {
  const row = args.row
  if (row === undefined || row.kind !== 'pull-request' || row.prNumber === null) return
  await args.tx.releasePullRequestTracking({
    userId: row.userId,
    repoFullName: row.repoFullName,
    prNumber: row.prNumber,
    at: args.at,
  })
}

export type UnsubscribeArgs = {
  tx: ControlTx
  session: ControlSessionRow
  subscriptionId: string
  by: ESubscriptionActor
  reason: ESubscriptionEnd
  at: string
}

export const unsubscribeIn = async (args: UnsubscribeArgs): Promise<{ ended: boolean }> => {
  const rows = await args.tx.readSessionSubscriptionRows(args.session.sessionId)
  const held = rows.find((row) => row.subscriptionId === args.subscriptionId)
  if (held === undefined) {
    const foreign = await args.tx.readSubscription(args.subscriptionId)
    if (foreign === undefined) return { ended: false }
    throw new Error(`subscription ${args.subscriptionId} belongs to another session`)
  }
  if (!(await args.tx.deleteSubscriptionRow(held.subscriptionId))) return { ended: false }
  await releasePullRequestOf({ tx: args.tx, row: held, at: args.at })
  await recordOf({
    tx: args.tx,
    session: args.session,
    threadId: held.threadId,
    event: {
      type: 'subscription-ended',
      subscriptionId: held.subscriptionId,
      reason: args.reason,
      by: args.by,
    },
    at: args.at,
  })
  return { ended: true }
}

export type SubscriptionEndingRow = { subscriptionId: string; threadId: string }

export const endSubscriptionsIn = async (args: {
  tx: ControlTx
  rows: readonly SubscriptionEndingRow[]
  by: ESubscriptionActor
  reason: ESubscriptionEnd
  at: string
  endedBefore?: string | undefined
}): Promise<number> => {
  let ended = 0
  for (const row of args.rows) {
    const thread = await args.tx.readThread(row.threadId)
    if (thread === undefined) continue
    const session = await args.tx.readSession({ sessionId: thread.sessionId })
    if (session === undefined) continue
    const held = await args.tx.readSubscription(row.subscriptionId)
    const removed =
      args.endedBefore === undefined
        ? await args.tx.deleteSubscriptionRow(row.subscriptionId)
        : await args.tx.deleteSubscriptionRowIfEndedBefore({
            subscriptionId: row.subscriptionId,
            at: args.endedBefore,
          })
    if (!removed) continue
    await releasePullRequestOf({ tx: args.tx, row: held, at: args.at })
    await recordOf({
      tx: args.tx,
      session,
      threadId: row.threadId,
      event: {
        type: 'subscription-ended',
        subscriptionId: row.subscriptionId,
        reason: args.reason,
        by: args.by,
      },
      at: args.at,
    })
    ended += 1
  }
  return ended
}
