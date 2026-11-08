import type { LogPort } from '@dltech/atlas-observability'
import { ECallFailure } from '@dltech/atlas-protocol'
import type { CallOp, CallResult, DaemonFrame } from '@dltech/atlas-protocol'

import { abandonCall, attachCallSignal } from './call-signal'
import {
  FencedError,
  ProtocolViolationError,
  ReadyTimeoutError,
  actionForAnswer,
  callLostAcrossBoot,
  needsRun,
  type DaemonAnswer,
} from './errors'
import { scopeDispatchedBootId } from './call-scope'
import { DaemonLink } from './link'
import { READY_TIMEOUT_MS, withReadyDeadline } from './ready-deadline'
import { ReadyGate, type ReadyReply } from './ready-gate'
import {
  failedResult,
  handedOffResult,
  handleDaemonFrame,
  interruptedResult,
  rejectPending,
  type Pending,
  type Waiter,
} from './remote-calls-frames'
import type { RemoteCallsArgs } from './remote-calls'

export class RemoteCallsState {
  private readonly pending = new Map<string, Pending>()
  private readonly pendingAcks = new Map<string, { key: string; resolve(found: boolean): void }>()
  private readonly asking = new Map<string, (answer: DaemonAnswer) => void>()
  private readonly link: DaemonLink
  private readonly log: LogPort | undefined

  private epoch = 0
  private linkBootId: string | undefined
  private fenced = false
  private closed = false
  private detached = false
  private down: Error | null = null
  private readonly gate = new ReadyGate()

  constructor(private readonly args: RemoteCallsArgs) {
    this.log = args.log
    this.link = new DaemonLink({
      timers: args.timers,
      ...(args.pingMs === undefined ? {} : { pingMs: args.pingMs }),
      events: {
        onFrame: (frame) => handleDaemonFrame(this.sink(), frame),
        onSuperseded: (reason) => {
          this.fenced = true
          args.onFenced()
          this.failAll(new FencedError(`session ${args.sessionId} lost its lease: ${reason}`))
        },
        onUnauthenticated: (reason) =>
          this.failAll(new ProtocolViolationError(`daemon refused the hello: ${reason}`)),
        onFatal: (error) => this.failAll(error),
      },
    })
  }

  open(args: { epoch: number }): void {
    this.epoch = args.epoch
    this.link.start({
      connector: this.args.connector,
      hello: () => ({
        kind: 'hello',
        sessionId: this.args.sessionId,
        epoch: this.epoch,
        token: this.args.token,
      }),
    })
  }

  ready(): Promise<ReadyReply> {
    this.reopenIfDown()
    return this.gate.promise
  }

  bootId(): string | undefined {
    return this.linkBootId
  }

  handoff(): void {
    this.detached = true
    this.refuseAnswers()
    for (const call of [...this.pending.values()]) {
      if (call.done) continue
      this.settle(call, handedOffResult(call))
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.link.teardown()
    this.refuseAnswers()
    const error = new FencedError(`session ${this.args.sessionId} closed its daemon link`)
    rejectPending({ pending: this.pending, pendingAcks: this.pendingAcks, error })
    this.gate.rejectSoon(error)
  }

  async invoke(args: {
    key: string
    op: CallOp
    signal?: AbortSignal | undefined
    onOutput?: ((bytes: Uint8Array) => void) | undefined
    dispatchedBootId?: string | undefined
  }): Promise<CallResult> {
    const dispatchedBootId = args.dispatchedBootId ?? scopeDispatchedBootId()
    if (this.fenced) throw new FencedError(`session ${this.args.sessionId} lost its lease`)
    this.reopenIfDown()
    if (this.closed) {
      throw new FencedError(`session ${this.args.sessionId} closed its daemon link`)
    }
    const waiter: Waiter = { settle: () => {}, onOutput: args.onOutput }
    const outcome = new Promise<CallResult>((resolve, reject) => {
      waiter.settle = resolve
      waiter.reject = reject
    })
    outcome.catch(() => undefined)
    const existing = this.pending.get(args.key)
    if (existing !== undefined) {
      if (this.detached) return outcome
      existing.waiters.push(waiter)
      return outcome
    }
    const call: Pending = {
      key: args.key,
      op: args.op,
      waiters: [],
      controller: new AbortController(),
      delivered: 0,
      sent: false,
      done: false,
      awaitingAnswer: false,
    }
    if (!this.detached) call.waiters.push(waiter)
    this.pending.set(args.key, call)
    if (args.signal !== undefined) this.attachSignal({ call, signal: args.signal })
    try {
      await this.readyWithin(call.controller.signal)
    } catch (error) {
      abandonCall({ call, pending: this.pending, error: error as Error })
      throw error
    }
    if (call.done) return outcome
    if (
      callLostAcrossBoot({
        op: call.op.op,
        dispatchedBootId,
        currentBootId: this.linkBootId,
      })
    ) {
      const answer = await this.answerOf(call.key)
      if (call.done || this.closed || this.fenced) return outcome
      const action = actionForAnswer({
        op: call.op.op,
        dispatchedBootId,
        currentBootId: this.linkBootId,
        answer,
      })
      if (!needsRun(action)) {
        this.settle(call, interruptedResult(args.op.op))
        return outcome
      }
      if (action.type === 'rerun') call.delivered = 0
    }
    if (this.link.ready) this.sendRun(call)
    return outcome
  }

  ack(args: { key: string }): Promise<void> {
    return this.ackKey({ key: args.key }).then(() => undefined)
  }

  async ackScope(args: { scopeKey: string; count?: number | undefined }): Promise<void> {
    if (args.count !== undefined) {
      for (let index = args.count - 1; index >= 0; index -= 1) {
        await this.ack({ key: `${args.scopeKey}.${index}` })
      }
      return
    }
    for (let index = 0; ; index += 1) {
      if (!(await this.ackKey({ key: `${args.scopeKey}.${index}` }))) return
    }
  }

  private async ackKey(args: { key: string }): Promise<boolean> {
    if (this.fenced || this.closed) return false
    try {
      await this.readyWithin()
    } catch (error) {
      if (this.fenced || this.closed || error instanceof ReadyTimeoutError) return false
      throw new ProtocolViolationError('the daemon link failed before the ack could be sent')
    }
    if (this.fenced || this.closed) return false
    return new Promise<boolean>((resolve) => {
      this.pendingAcks.set(args.key, { key: args.key, resolve })
      if (this.link.ready) this.link.send({ kind: 'ack', key: args.key, epoch: this.epoch })
    })
  }

  private readyWithin(signal?: AbortSignal): Promise<ReadyReply | undefined> {
    return withReadyDeadline({
      promise: this.gate.promise,
      timeoutMs: this.args.readyTimeoutMs ?? READY_TIMEOUT_MS,
      timers: this.args.timers,
      signal,
    })
  }

  private attachSignal(args: { call: Pending; signal: AbortSignal }): void {
    attachCallSignal({
      call: args.call,
      signal: args.signal,
      isDetached: () => this.detached,
      isLinkReady: () => this.link.ready,
      sendCancel: () => {
        if (!this.link.ready) return
        this.link.send({ kind: 'cancel', key: args.call.key, epoch: this.epoch })
      },
      settleInterrupted: () => this.settle(args.call, interruptedResult(args.call.op.op)),
    })
  }

  private settle(call: Pending, result: CallResult): void {
    if (call.done) return
    call.done = true
    this.pending.delete(call.key)
    call.detach?.()
    for (const waiter of call.waiters) {
      waiter.settle(result)
    }
  }

  private settleError(call: Pending, error: Error): void {
    this.settle(
      call,
      failedResult({ op: call.op.op, code: ECallFailure.Internal, message: error.message }),
    )
  }

  private sendRun(call: Pending): void {
    call.sent = true
    this.link.send({
      kind: 'run',
      key: call.key,
      epoch: this.epoch,
      op: call.op,
      ...(call.delivered > 0 ? { fromOffset: call.delivered } : {}),
    })
    if (call.controller.signal.aborted) {
      this.link.send({ kind: 'cancel', key: call.key, epoch: this.epoch })
    }
  }

  private handleHelloReply(frame: { bootId: string; version: string }): void {
    const previousBootId = this.linkBootId
    const restart = previousBootId !== undefined && previousBootId !== frame.bootId
    this.linkBootId = frame.bootId
    this.link.markReady()
    this.gate.resolve(frame)
    for (const ack of this.pendingAcks.values()) {
      this.link.send({ kind: 'ack', key: ack.key, epoch: this.epoch })
    }
    if (restart) this.recoverAcrossRestart(previousBootId)
    for (const call of this.pending.values()) {
      if (call.done || call.awaitingAnswer) continue
      this.sendRun(call)
    }
    this.link.schedulePing()
  }

  private recoverAcrossRestart(previousBootId: string): void {
    for (const call of [...this.pending.values()]) {
      if (call.done) continue
      void this.recover({ call, previousBootId })
    }
  }

  private async recover(args: { call: Pending; previousBootId: string }): Promise<void> {
    const { call } = args
    call.awaitingAnswer = true
    const answer = await this.answerOf(call.key)
    call.awaitingAnswer = false
    if (call.done || this.closed || this.fenced) return
    const action = actionForAnswer({
      op: call.op.op,
      dispatchedBootId: args.previousBootId,
      currentBootId: this.linkBootId,
      answer,
    })
    if (!needsRun(action)) {
      this.settle(call, interruptedResult(call.op.op))
      return
    }
    if (action.type === 'rerun') call.delivered = 0
    if (this.link.ready) this.sendRun(call)
  }

  private answerOf(key: string): Promise<DaemonAnswer> {
    if (!this.link.ready) return Promise.resolve('unavailable')
    return new Promise<DaemonAnswer>((resolve) => {
      this.asking.set(key, resolve)
      this.link.send({ kind: 'answer', key, epoch: this.epoch })
    })
  }

  private answered(key: string, state: DaemonAnswer): void {
    const resolve = this.asking.get(key)
    if (resolve === undefined) return
    this.asking.delete(key)
    resolve(state)
  }

  private refuseAnswers(): void {
    for (const key of [...this.asking.keys()]) this.answered(key, 'unavailable')
  }

  private reopenIfDown(): void {
    if (this.down === null || this.fenced || this.closed) return
    this.down = null
    this.gate.rearm()
    this.link.restart()
  }

  private failAll(error: Error): void {
    if (!(error instanceof FencedError)) this.down = error
    this.link.teardown()
    this.refuseAnswers()
    this.gate.reject(error)
    for (const call of [...this.pending.values()]) this.settleError(call, error)
    for (const ack of [...this.pendingAcks.values()]) ack.resolve(false)
    this.pendingAcks.clear()
    this.log?.error({ source: 'remote-calls', message: error.message })
  }

  private sink() {
    return {
      pending: this.pending,
      pendingAcks: this.pendingAcks,
      link: this.link,
      settle: (call: Pending, result: CallResult) => this.settle(call, result),
      settleError: (call: Pending, error: Error) => this.settleError(call, error),
      sendRun: (call: Pending) => this.sendRun(call),
      failAll: (error: Error) => this.failAll(error),
      handleHelloReply: (frame: { bootId: string; version: string }) =>
        this.handleHelloReply(frame),
      answered: (key: string, state: DaemonAnswer) => this.answered(key, state),
      emitEvent: (frame: Extract<DaemonFrame, { kind: 'event' }>) => this.args.onEvent?.(frame),
    }
  }
}
