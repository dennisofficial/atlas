import { randomUUID } from 'node:crypto'

import type {
  OperatorRequestAnswer,
  OperatorRequestOpen,
  OperatorRequestPort,
} from '@dltech/atlas-host'
import type { PodOperatorAsk } from '@dltech/atlas-plugin-sdk'

import { EOperatorRequestStatus, type OperatorRequestStore } from './store'

export const OPERATOR_REQUEST_TTL_MS = 15 * 60_000

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

type Pending = {
  requestId: string
  sessionId: string
  userId: string
  expiresAt: Date
  answer(answer: OperatorRequestAnswer): void
  timer: unknown
}

export type OperatorRequestRegistryArgs = {
  store: OperatorRequestStore
  ttlMs?: number | undefined
  now?: (() => number) | undefined
  timers?: OperatorRegistryTimers | undefined
}

export class OperatorRequestRegistry {
  private readonly store: OperatorRequestStore
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly timers: OperatorRegistryTimers
  private readonly pending = new Map<string, Pending>()
  private readonly waiting = new Map<string, string>()

  constructor(args: OperatorRequestRegistryArgs) {
    this.store = args.store
    this.ttlMs = args.ttlMs ?? OPERATOR_REQUEST_TTL_MS
    this.now = args.now ?? (() => Date.now())
    this.timers = args.timers ?? systemTimers
  }

  async open(args: {
    sessionId: string
    threadId: string
    ask: PodOperatorAsk
  }): Promise<OperatorRequestOpen> {
    if (this.waiting.has(args.sessionId))
      throw new Error('this session is already waiting on an operator request')
    const userId = await this.store.sessionOwner(args.sessionId)
    if (userId === null) throw new Error('this session has no owner to ask for input')

    const requestId = `oreq_${randomUUID()}`
    const createdAt = new Date(this.now())
    const expiresAt = new Date(createdAt.getTime() + this.ttlMs)
    await this.store.insertPending({
      id: requestId,
      sessionId: args.sessionId,
      threadId: args.threadId,
      kind: args.ask.kind,
      prompt: args.ask.prompt,
      secret: args.ask.secret,
      ...(args.ask.kind === 'shell' ? { shellId: args.ask.shellId } : {}),
      createdAt,
      expiresAt,
    })

    let settle: (answer: OperatorRequestAnswer) => void = () => {}
    const answered = new Promise<OperatorRequestAnswer>((resolve) => {
      settle = resolve
    })
    const entry: Pending = {
      requestId,
      sessionId: args.sessionId,
      userId,
      expiresAt,
      answer: settle,
      timer: undefined,
    }
    entry.timer = this.timers.setTimeout(() => {
      void this.finish({
        requestId,
        status: EOperatorRequestStatus.Expired,
        answer: { ok: false, reason: 'expired' },
      })
    }, this.ttlMs)
    this.pending.set(requestId, entry)
    this.waiting.set(args.sessionId, requestId)

    return {
      requestId,
      expiresAt,
      answered,
      abandon: (reason) => {
        void this.finish({
          requestId,
          status:
            reason === 'cancelled'
              ? EOperatorRequestStatus.Cancelled
              : EOperatorRequestStatus.Abandoned,
          answer: { ok: false, reason },
        })
      },
    }
  }

  async answer(args: {
    requestId: string
    userId: string
    value: string
  }): Promise<OperatorRequestOutcome> {
    const held = await this.held({ requestId: args.requestId, userId: args.userId })
    if ('ok' in held) return held
    const done = await this.finish({
      requestId: args.requestId,
      status: EOperatorRequestStatus.Answered,
      answer: { ok: true, value: args.value },
    })
    return done ? { ok: true } : { ok: false, status: 404, reason: 'request' }
  }

  async cancel(args: { requestId: string; userId: string }): Promise<OperatorRequestOutcome> {
    const held = await this.held({ requestId: args.requestId, userId: args.userId })
    if ('ok' in held) return held
    const done = await this.finish({
      requestId: args.requestId,
      status: EOperatorRequestStatus.Cancelled,
      answer: { ok: false, reason: 'cancelled' },
    })
    return done ? { ok: true } : { ok: false, status: 404, reason: 'request' }
  }

  private async held(args: {
    requestId: string
    userId: string
  }): Promise<Pending | OperatorRefusal> {
    const entry = this.pending.get(args.requestId)
    if (entry === undefined) return await this.absent(args.requestId)
    if (entry.userId !== args.userId) return { ok: false, status: 403, reason: 'request' }
    if (this.now() >= entry.expiresAt.getTime()) {
      await this.finish({
        requestId: args.requestId,
        status: EOperatorRequestStatus.Expired,
        answer: { ok: false, reason: 'expired' },
      })
      return { ok: false, status: 404, reason: 'request' }
    }
    return entry
  }

  private async absent(requestId: string): Promise<OperatorRefusal> {
    const status = await this.store.statusOf(requestId)
    if (status !== EOperatorRequestStatus.Pending)
      return { ok: false, status: 404, reason: 'request' }
    return { ok: false, status: 409, reason: 'not_held_here' }
  }

  private async finish(args: {
    requestId: string
    status: EOperatorRequestStatus
    answer: OperatorRequestAnswer
  }): Promise<boolean> {
    const entry = this.pending.get(args.requestId)
    if (entry === undefined) return false
    this.pending.delete(args.requestId)
    if (this.waiting.get(entry.sessionId) === args.requestId) this.waiting.delete(entry.sessionId)
    this.timers.clearTimeout(entry.timer)
    const settled = await this.store
      .settle({ id: args.requestId, status: args.status, at: new Date(this.now()) })
      .catch(() => false)
    entry.answer(args.answer)
    return settled
  }
}

export const operatorRequestPortOf = (registry: OperatorRequestRegistry): OperatorRequestPort => ({
  open: (args) => registry.open(args),
})
