import type { NotifyDispatch } from '@dltech/atlas-host'
import { notifySendIdempotencyKey, type NotifySendPayload } from '@dltech/atlas-jobs/notify'

import type { JobsProjectDispatcher } from '../../_core/ports/job-dispatcher'
import { notifySendTaskContract } from '../../_lib/trigger/notify-send.contract'

export const notifyDispatchOf =
  (args: { dispatcher: JobsProjectDispatcher }): NotifyDispatch =>
  async (send) => {
    const { decision } = send
    const payload: NotifySendPayload = {
      sessionId: send.sessionId,
      threadId: send.threadId,
      seq: send.seq,
      moment: send.moment,
      holdMs: decision.holdMs,
      pending: [...decision.pending],
      operatorTurn: decision.operatorTurn,
    }
    await args.dispatcher.dispatch({
      task: notifySendTaskContract,
      payload,
      idempotencyKey: notifySendIdempotencyKey(payload),
      ...(decision.holdMs > 0 ? { delay: `${Math.round(decision.holdMs / 1000)}s` } : {}),
    })
  }
