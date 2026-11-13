import type { Tx } from '@dltech/atlas-db'
import type {
  OperatorAnswer,
  OperatorAnswerHandoff,
  OperatorAnswerKey,
  OperatorDeliveryResult,
  OperatorRequestPort,
} from '@dltech/atlas-host'

import type { OperatorSessionStore } from './store'

export const OPERATOR_ANSWER_KIND = 'operator-answer'

export const OPERATOR_ANSWER_TIMEOUT_MS = 120_000

export const ANSWER_TIMED_OUT = 'the session did not wake in time; try again'

export type OperatorRegistryTimers = {
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const systemTimers: OperatorRegistryTimers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
}

export type OperatorRefusal = { ok: false; status: 404 | 409; reason: string }

export type OperatorRequestOutcome = { ok: true } | OperatorRefusal

type Waiter = (result: OperatorDeliveryResult) => void

const keyOf = (key: OperatorAnswerKey): string => `${key.sessionId}:${key.callId}`

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
  answerTimeoutMs?: number | undefined
  now?: (() => number) | undefined
  timers?: OperatorRegistryTimers | undefined
}

export class OperatorRequestRegistry {
  private readonly store: OperatorSessionStore
  private readonly answerTimeoutMs: number
  private readonly now: () => number
  private readonly timers: OperatorRegistryTimers
  private readonly values = new Map<string, OperatorAnswer>()
  private readonly waiters = new Map<string, Waiter>()

  constructor(private readonly args: OperatorRequestRegistryArgs) {
    this.store = args.store
    this.answerTimeoutMs = args.answerTimeoutMs ?? OPERATOR_ANSWER_TIMEOUT_MS
    this.now = args.now ?? (() => Date.now())
    this.timers = args.timers ?? systemTimers
  }

  readonly answers: OperatorAnswerHandoff = {
    take: (key) => {
      const id = keyOf(key)
      const value = this.values.get(id)
      this.values.delete(id)
      return value
    },
    resolve: (params) => {
      const id = keyOf(params.key)
      const waiter = this.waiters.get(id)
      this.waiters.delete(id)
      this.values.delete(id)
      waiter?.(params.result)
    },
  }

  async answer(args: {
    sessionId: string
    callId: string
    userId: string
    value: string
  }): Promise<OperatorRequestOutcome> {
    return await this.hand({ ...args, answer: { ok: true, value: args.value } })
  }

  async cancel(args: {
    sessionId: string
    callId: string
    userId: string
  }): Promise<OperatorRequestOutcome> {
    return await this.hand({ ...args, answer: { ok: false, cancel: true } })
  }

  private async hand(args: {
    sessionId: string
    callId: string
    userId: string
    answer: OperatorAnswer
  }): Promise<OperatorRequestOutcome> {
    const owner = await this.store.sessionOwner(args.sessionId)
    if (owner === null || owner !== args.userId)
      return { ok: false, status: 404, reason: 'session' }

    const key = { sessionId: args.sessionId, callId: args.callId }
    const id = keyOf(key)
    this.values.set(id, args.answer)
    const delivered = new Promise<OperatorDeliveryResult>((resolve) => {
      this.waiters.set(id, resolve)
    })
    await this.args.withTx((tx) =>
      this.args.post({
        tx,
        sessionId: args.sessionId,
        kind: OPERATOR_ANSWER_KIND,
        payload: JSON.stringify({ callId: args.callId }),
        at: new Date(this.now()).toISOString(),
      }),
    )

    const result = await this.awaited(delivered)
    this.values.delete(id)
    if (!result.ok) return { ok: false, status: 409, reason: result.reason }
    return { ok: true }
  }

  private async awaited(
    delivered: Promise<OperatorDeliveryResult>,
  ): Promise<OperatorDeliveryResult> {
    const timedOut = new Promise<OperatorDeliveryResult>((resolve) => {
      const timer = this.timers.setTimeout(
        () => resolve({ ok: false, reason: ANSWER_TIMED_OUT }),
        this.answerTimeoutMs,
      )
      void delivered.then(() => this.timers.clearTimeout(timer))
    })
    return await Promise.race([delivered, timedOut])
  }
}

export const operatorRequestPortOf = (registry: OperatorRequestRegistry): OperatorRequestPort => ({
  answers: registry.answers,
})
