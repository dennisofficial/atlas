import type { Tx } from '@dltech/atlas-db'
import {
  INBOX_KIND_OPERATOR_ANSWER,
  type OperatorAnswerPayload,
} from '@dltech/atlas-plugin-operator/core'

import type { OperatorSessionStore } from './store'

export const OPERATOR_ANSWER_KIND = INBOX_KIND_OPERATOR_ANSWER

export type OperatorRefusal = { ok: false; status: 404; reason: string }

export type OperatorRequestOutcome = { ok: true } | OperatorRefusal

export type OperatorRequestRegistryArgs = {
  store: OperatorSessionStore
  post: (args: {
    tx: Tx
    sessionId: string
    kind: string
    payload: string
    at: string
  }) => Promise<{ inboxId: number }>
  withTx: <T>(run: (tx: Tx) => Promise<T>) => Promise<T>
  now?: (() => number) | undefined
}

type AnswerArgs = { sessionId: string; callId: string; userId: string }

export class OperatorRequestRegistry {
  constructor(private readonly args: OperatorRequestRegistryArgs) {}

  async answer(args: AnswerArgs & { value: string }): Promise<OperatorRequestOutcome> {
    return await this.post({ ...args, payload: { callId: args.callId, value: args.value } })
  }

  async cancel(args: AnswerArgs): Promise<OperatorRequestOutcome> {
    return await this.post({ ...args, payload: { callId: args.callId, cancel: true } })
  }

  private async post(
    args: AnswerArgs & { payload: OperatorAnswerPayload },
  ): Promise<OperatorRequestOutcome> {
    const owner = await this.args.store.sessionOwner(args.sessionId)
    if (owner === null || owner !== args.userId)
      return { ok: false, status: 404, reason: 'session' }
    await this.args.withTx((tx) =>
      this.args.post({
        tx,
        sessionId: args.sessionId,
        kind: OPERATOR_ANSWER_KIND,
        payload: JSON.stringify(args.payload),
        at: new Date((this.args.now ?? Date.now)()).toISOString(),
      }),
    )
    return { ok: true }
  }
}
