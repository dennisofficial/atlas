import { EDaemonAnswer } from '@dltech/atlas-core'
import type { LogPort } from '@dltech/atlas-observability'
import { ECallFailure } from '@dltech/atlas-protocol'
import type { CallResult, DaemonFrame } from '@dltech/atlas-protocol'

import { Answers } from './answers'
import { openCall, type CallLane, type OpenCallArgs } from './call-open'
import { scopeDispatchedBootId } from './call-scope'
import { FencedError, ProtocolViolationError, type DaemonAnswer } from './errors'
import { handleHello } from './hello-reply'
import { DaemonLink } from './link'
import { READY_TIMEOUT_MS, withReadyDeadline } from './ready-deadline'
import { ReadyGate, type ReadyReply } from './ready-gate'
import {
  failedResult,
  handedOffResult,
  handleDaemonFrame,
  rejectPending,
  type Pending,
} from './remote-calls-frames'
import type { RemoteCallsArgs } from './remote-calls'
import { interruptPendingForResize } from './restart-interrupt'
import { ScopeAcks } from './scope-acks'

export { ACK_TIMEOUT_MS } from './scope-acks'

type StateArgs = RemoteCallsArgs & { releaseResize(): void; resizeReason(): string | undefined }

export class RemoteCallsState {
  private readonly pending = new Map<string, Pending>()
  private readonly acks: ScopeAcks
  private readonly answers: Answers
  private readonly link: DaemonLink
  private readonly lane: CallLane
  private readonly log: LogPort | undefined
  private readonly onReady: ((hello: { bootId: string; restart: boolean }) => void) | undefined

  private epoch = 0
  private linkBootId: string | undefined
  private fencedAt: number | undefined
  private closed = false
  private detached = false
  private down: Error | null = null
  private readonly gate = new ReadyGate()

  constructor(private readonly args: StateArgs) {
    this.log = args.log
    this.link = new DaemonLink({
      timers: args.timers,
      sessionId: args.sessionId,
      log: args.log,
      ...(args.pingMs === undefined ? {} : { pingMs: args.pingMs }),
      ...(args.handshakeMs === undefined ? {} : { handshakeMs: args.handshakeMs }),
      events: {
        onFrame: (frame) => handleDaemonFrame(this.sink(), frame),
        onDown: () => this.handleLinkDown(),
        onSuperseded: (reason) => {
          this.fencedAt = this.epoch
          args.onFenced()
          this.failAll(new FencedError(`session ${args.sessionId} lost its lease: ${reason}`))
        },
        onUnauthenticated: (reason) =>
          this.failAll(new ProtocolViolationError(`daemon refused the hello: ${reason}`)),
        onFatal: (error) => this.failAll(error),
      },
    })
    this.answers = new Answers({ link: this.link, epoch: () => this.epoch })
    this.onReady = args.onReady
    this.acks = new ScopeAcks({
      timers: args.timers,
      sessionId: args.sessionId,
      log: args.log,
      link: this.link,
      epoch: () => this.epoch,
      gone: () => this.fenced || this.closed,
      readyWithin: (signal) => this.readyWithin(signal),
    })
    this.lane = {
      pending: this.pending,
      answers: this.answers,
      detached: () => this.detached,
      gone: () => this.closed || this.fenced,
      linkReady: () => this.link.ready,
      bootId: () => this.linkBootId,
      ready: (signal) => this.readyWithin(signal),
      arrived: (frame) => {
        this.linkBootId = frame.bootId
        this.link.markReady()
        this.gate.resolve(frame)
      },
      flushAcks: () => this.acks.flush(),
      logged: (fields) =>
        this.log?.info({
          source: 'calls.link',
          message: 'daemon link back up',
          data: { sessionId: args.sessionId, ...fields },
        }),
      helloReady: (hello) => this.onReady?.(hello),
      listed: () => [...this.pending.values()],
      sendCancel: (call) => {
        if (!this.link.ready) return
        this.link.send({ kind: 'cancel', key: call.key, epoch: this.epoch })
      },
      sendRun: (call) => this.sendRun(call),
      resizeReason: () => this.args.resizeReason(),
      settle: (call, result) => this.settle(call, result),
      schedulePing: () => this.link.schedulePing(),
    }
  }

  open(args: { epoch: number }): void {
    const tookOver = this.leaseTookOver(args.epoch)
    this.epoch = args.epoch
    if (tookOver) this.gate.rearm()
    this.link.start({
      connector: this.args.connector,
      hello: () => ({
        kind: 'hello',
        sessionId: this.args.sessionId,
        epoch: this.epoch,
        token: typeof this.args.token === 'function' ? this.args.token() : this.args.token,
      }),
    })
  }

  private leaseTookOver(epoch: number): boolean {
    if (this.fencedAt === undefined || epoch <= this.fencedAt) return false
    this.fencedAt = undefined
    this.down = null
    return true
  }

  private get fenced(): boolean {
    return this.fencedAt !== undefined
  }

  async ready(): Promise<ReadyReply> {
    this.reopenIfDown()
    const reply = await withReadyDeadline({
      promise: this.gate.promise,
      timeoutMs: this.timeoutMs(),
      timers: this.args.timers,
      ...(this.args.started === undefined ? {} : { armedAfter: this.args.started }),
    })
    return reply
  }

  bootId(): string | undefined {
    return this.linkBootId
  }

  handoff(): void {
    this.detached = true
    this.args.releaseResize()
    this.answers.refuseAll()
    for (const call of [...this.pending.values()]) {
      if (call.done) continue
      this.settle(call, handedOffResult(call))
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.args.releaseResize()
    this.link.teardown()
    this.answers.refuseAll()
    const error = new FencedError(`session ${this.args.sessionId} closed its daemon link`)
    rejectPending({ pending: this.pending, error })
    this.acks.releaseAll()
    this.gate.rejectSoon(error)
  }

  async invoke(args: OpenCallArgs): Promise<CallResult> {
    const dispatchedBootId = args.dispatchedBootId ?? scopeDispatchedBootId()
    if (this.fenced) throw new FencedError(`session ${this.args.sessionId} lost its lease`)
    this.reopenIfDown()
    if (this.closed) {
      throw new FencedError(`session ${this.args.sessionId} closed its daemon link`)
    }
    return await openCall({ lane: this.lane, request: args, dispatchedBootId })
  }

  ack(args: { key: string }): Promise<void> {
    return this.acks.ack({ key: args.key }).then(() => undefined)
  }

  ackScope(args: { scopeKey: string; count?: number | undefined }): Promise<void> {
    return this.acks.scope(args)
  }

  interruptForRestart(args: { reason: string }): void {
    interruptPendingForResize({
      pending: this.pending,
      reason: args.reason,
      cancel: (call) => {
        if (this.link.ready) this.link.send({ kind: 'cancel', key: call.key, epoch: this.epoch })
      },
      settle: (call, result) => this.settle(call, result),
    })
  }

  private timeoutMs(): number {
    return this.args.readyTimeoutMs ?? READY_TIMEOUT_MS
  }

  private readyWithin(signal?: AbortSignal): Promise<ReadyReply | undefined> {
    return withReadyDeadline({
      promise: this.gate.promise,
      timeoutMs: this.timeoutMs(),
      timers: this.args.timers,
      signal,
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

  private handleLinkDown(): void {
    this.gate.rearm()
    this.answers.refuseAll()
  }

  private reopenIfDown(): void {
    if (this.down === null || this.fenced || this.closed) return
    this.down = null
    this.gate.rearm()
    this.link.restart()
  }

  private failAll(error: Error): void {
    this.args.releaseResize()
    if (!(error instanceof FencedError)) this.down = error
    this.link.teardown()
    this.answers.refuseAll()
    this.gate.reject(error)
    for (const call of [...this.pending.values()]) this.settleError(call, error)
    this.acks.releaseAll()
    this.log?.error({ source: 'remote-calls', message: error.message })
  }

  private sink() {
    return {
      pending: this.pending,
      settleAck: (args: { key: string; found: boolean }) => this.acks.settle(args),
      link: this.link,
      settle: (call: Pending, result: CallResult) => this.settle(call, result),
      settleError: (call: Pending, error: Error) => this.settleError(call, error),
      sendRun: (call: Pending) => this.sendRun(call),
      failAll: (error: Error) => this.failAll(error),
      handleHelloReply: (frame: { bootId: string; version: string }) =>
        handleHello(this.lane, frame),
      answered: (key: string, state: DaemonAnswer | EDaemonAnswer) =>
        this.answers.settle({ key, state }),
      emitEvent: (frame: Extract<DaemonFrame, { kind: 'event' }>) => this.args.onEvent?.(frame),
    }
  }
}
