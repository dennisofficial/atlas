import { randomUUID } from 'node:crypto'

import { EOperatorRequestOutcome } from '@dltech/atlas-plugin-operator/core'
import type { Tx } from '@dltech/atlas-db'
import type {
  OperatorAnswer,
  OperatorAnswerHandoff,
  OperatorDeliveryResult,
  OperatorRequestOpen,
  OperatorRequestSettle,
  OperatorRequestPort,
} from '@dltech/atlas-host'
import type { PodOperatorAsk } from '@dltech/atlas-plugin-sdk'

import { EOperatorRequestStatus, type OperatorRequestStore } from './store'

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

export type OperatorRefusal = { ok: false; status: 404 | 403 | 409; reason: string }

export type OperatorRequestOutcome = { ok: true } | OperatorRefusal

type Waiter = (result: OperatorDeliveryResult) => void

const STATUS_OF_OUTCOME: Readonly<Record<EOperatorRequestOutcome, EOperatorRequestStatus>> = {
  [EOperatorRequestOutcome.Delivered]: EOperatorRequestStatus.Answered,
  [EOperatorRequestOutcome.Cancelled]: EOperatorRequestStatus.Cancelled,
  [EOperatorRequestOutcome.Abandoned]: EOperatorRequestStatus.Abandoned,
  [EOperatorRequestOutcome.Expired]: EOperatorRequestStatus.Expired,
  [EOperatorRequestOutcome.Failed]: EOperatorRequestStatus.Failed,
}

export type OperatorRequestRegistryArgs = {
  store: OperatorRequestStore
  post: (args: {
    tx: Tx
    sessionId: string
    kind: string
    payload: string
    at: string
  }) => Promise<{
    inboxId: number
  }>
  withTx: <T>(run: (tx: Tx) => Promise<T>) => Promise<T>
  answerTimeoutMs?: number | undefined
  now?: (() => number) | undefined
  timers?: OperatorRegistryTimers | undefined
}

export class OperatorRequestRegistry {
  private readonly store: OperatorRequestStore
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
    take: (requestId) => {
      const value = this.values.get(requestId)
      this.values.delete(requestId)
      return value
    },
    resolve: (params) => {
      const waiter = this.waiters.get(params.requestId)
      this.waiters.delete(params.requestId)
      this.values.delete(params.requestId)
      waiter?.(params.result)
    },
  }

  async open(args: {
    sessionId: string
    threadId: string
    ask: PodOperatorAsk
  }): Promise<OperatorRequestOpen> {
    const userId = await this.store.sessionOwner(args.sessionId)
    if (userId === null) throw new Error('this session has no owner to ask for input')
    if (await this.store.hasPending(args.sessionId))
      throw new Error('this session is already waiting on an operator request')

    const requestId = `oreq_${randomUUID()}`
    await this.store.insertPending({
      id: requestId,
      sessionId: args.sessionId,
      threadId: args.threadId,
      kind: args.ask.kind,
      prompt: args.ask.prompt,
      ...(args.ask.kind === 'shell' ? { shellId: args.ask.shellId } : {}),
      createdAt: new Date(this.now()),
    })
    return { requestId }
  }

  async answer(args: {
    requestId: string
    userId: string
    value: string
  }): Promise<OperatorRequestOutcome> {
    return await this.hand({ ...args, answer: { ok: true, value: args.value } })
  }

  async cancel(args: { requestId: string; userId: string }): Promise<OperatorRequestOutcome> {
    return await this.hand({ ...args, answer: { ok: false, cancel: true } })
  }

  private async hand(args: {
    requestId: string
    userId: string
    answer: OperatorAnswer
  }): Promise<OperatorRequestOutcome> {
    const held = await this.store.held({ id: args.requestId, userId: args.userId })
    if (held === 'absent') return { ok: false, status: 404, reason: 'request' }
    if (held === 'forbidden') return { ok: false, status: 403, reason: 'request' }

    this.values.set(args.requestId, args.answer)
    const delivered = new Promise<OperatorDeliveryResult>((resolve) => {
      this.waiters.set(args.requestId, resolve)
    })
    await this.args.withTx((tx) =>
      this.args.post({
        tx,
        sessionId: held.sessionId,
        kind: OPERATOR_ANSWER_KIND,
        payload: JSON.stringify({ requestId: args.requestId }),
        at: new Date(this.now()).toISOString(),
      }),
    )

    const result = await this.awaited(delivered)
    this.values.delete(args.requestId)
    if (!result.ok) return { ok: false, status: 409, reason: result.reason }
    return { ok: true }
  }

  async settle(args: OperatorRequestSettle): Promise<boolean> {
    return await this.store.settle({
      id: args.requestId,
      status: STATUS_OF_OUTCOME[args.outcome],
      at: args.at ?? new Date(this.now()),
    })
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
  open: (args) => registry.open(args),
  settle: (args) => registry.settle(args),
  answers: registry.answers,
})
