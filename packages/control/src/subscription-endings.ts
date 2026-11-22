import type { ESubscriptionActor, ESubscriptionEnd } from '@dltech/atlas-core'

import type { ControlSessionRow, ControlTx } from './port'
import { recordOf } from './subscription-rows'

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
    const removed =
      args.endedBefore === undefined
        ? await args.tx.deleteSubscriptionRow(row.subscriptionId)
        : await args.tx.deleteSubscriptionRowIfEndedBefore({
            subscriptionId: row.subscriptionId,
            at: args.endedBefore,
          })
    if (!removed) continue
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
