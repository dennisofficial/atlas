import {
  ESubscriptionActor,
  ESubscriptionEnd,
  ETargetPhase,
  INBOX_KIND_EVENT,
  inboxEventPayloadOf,
  toThreadId,
  subscribedTargetOf,
  type EventBody,
  type SubscribedTarget,
  type SubscriptionTargetState,
} from '@dltech/atlas-core'

import { postIn } from './inbox-ops'
import type { ControlSessionRow, ControlTx } from './port'
import { endSubscriptionsIn } from './subscription-endings'
import { subscribeIn, type SubscribeArgs, type SubscribeResult } from './subscription-ops'

export const terminalNoticeClientIdOf = (subscriptionId: string): string =>
  `subscription-terminal:${subscriptionId}`

export const completeSubscriptionIn = async (args: {
  tx: ControlTx
  session: ControlSessionRow
  subscriptionId: string
  threadId: string
  notice: EventBody
  at: string
}): Promise<boolean> => {
  await postIn({
    tx: args.tx,
    sessionId: args.session.sessionId,
    kind: INBOX_KIND_EVENT,
    payload: inboxEventPayloadOf({
      event: args.notice,
      clientId: terminalNoticeClientIdOf(args.subscriptionId),
    }),
    at: args.at,
    ...(args.threadId === args.session.mainThreadId ? {} : { threadId: toThreadId(args.threadId) }),
  })
  const ended = await endSubscriptionsIn({
    tx: args.tx,
    rows: [{ subscriptionId: args.subscriptionId, threadId: args.threadId }],
    by: ESubscriptionActor.Provider,
    reason: ESubscriptionEnd.Completed,
    at: args.at,
  })
  return ended > 0
}

export type SubscribeToStateResult = SubscribeResult & { target?: SubscribedTarget | undefined }

export const subscribeToStateIn = async (
  args: SubscribeArgs & { state: SubscriptionTargetState },
): Promise<SubscribeToStateResult> => {
  const { state, ...subscribeArgs } = args
  const subscribed = await subscribeIn(subscribeArgs)
  const target = subscribedTargetOf(state)
  if (state.phase !== ETargetPhase.Terminal) {
    return target === undefined ? subscribed : { ...subscribed, target }
  }
  const ended = await completeSubscriptionIn({
    tx: args.tx,
    session: args.session,
    subscriptionId: subscribed.subscription.id,
    threadId: subscribed.subscription.threadId,
    notice: state.notice,
    at: args.at,
  })
  return { ...subscribed, target: { phase: state.phase, summary: state.summary, ended } }
}
