import type { LogPort } from '@dltech/atlas-observability'
import type { CallResult } from '@dltech/atlas-protocol'

import { Answers } from './answers'
import { callLaneOf } from './call-lane'
import { openCall, type CallLane, type OpenCallArgs } from './call-open'
import { CancelObligations } from './cancel-obligations'
import { scopeDispatchedBootId } from './call-scope'
import { FencedError, ProtocolViolationError } from './errors'
import { handleHello } from './hello-reply'
import { DaemonLink } from './link'
import { READY_TIMEOUT_MS, withReadyDeadline } from './ready-deadline'
import { ReadyGate, type ReadyReply } from './ready-gate'
import {
  handedOffResult,
  handleDaemonFrame,
  rejectPending,
  type FrameSink,
  type Pending,
} from './remote-calls-frames'
import { settleCall, settleFailed } from './remote-calls-settle'
import { frameSinkOf } from './remote-calls-sink'
import type { RemoteCallsArgs, ScopeCancelled } from './remote-calls'
import { interruptPendingForResize } from './restart-interrupt'
import { ScopeAcks } from './scope-acks'
import { sendCancelScope } from './scope-cancel'

export { ACK_TIMEOUT_MS } from './scope-acks'

type StateArgs = RemoteCallsArgs & {
  releaseResize(): void
  resizeReason(): string | undefined
  onScopeCancelled(cancelled: ScopeCancelled): void
}

export class RemoteCallsState {
  private readonly pending = new Map<string, Pending>()
  private readonly cancels: CancelObligations
  private readonly acks: ScopeAcks
  private readonly answers: Answers
  private readonly link: DaemonLink
  private readonly lane: CallLane
  private readonly log: LogPort | undefined
  private readonly onReady: ((hello: { bootId: string; restart: boolean }) => void) | undefined

  private epoch = 0
  private linkBootId: string | undefined
  private capabilities: readonly string[] = []
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
    this.cancels = new CancelObligations({
      link: this.link,
      epoch: () => this.epoch,
      bootId: () => this.linkBootId,
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
    this.lane = callLaneOf({
      pending: this.pending,
      answers: this.answers,
      detached: () => this.detached,
      gone: () => this.closed || this.fenced,
      linkReady: () => this.link.ready,
      bootId: () => this.linkBootId,
      ready: (signal) => this.readyWithin(signal),
      arrived: (frame) => {
        this.linkBootId = frame.bootId
        this.capabilities = frame.capabilities ?? []
        this.link.markReady()
        this.gate.resolve(frame)
      },
      flushAcks: () => this.acks.flush(),
      flushCancels: (bootId) => this.cancels.flush(bootId),
      logged: (fields) =>
        this.log?.info({
          source: 'calls.link',
          message: 'daemon link back up',
          data: { sessionId: this.args.sessionId, ...fields },
        }),
      helloReady: (hello) => this.onReady?.(hello),
      listed: () => [...this.pending.values()],
      sendCancel: (call) => this.cancels.cancel(call.key),
      sendRun: (call) => this.sendRun(call),
      resizeReason: () => this.args.resizeReason(),
      settle: (call, result) => this.settle(call, result),
      schedulePing: () => this.link.schedulePing(),
    })
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
      timeoutMs: this.args.readyTimeoutMs ?? READY_TIMEOUT_MS,
      timers: this.args.timers,
      ...(this.args.started === undefined ? {} : { armedAfter: this.args.started }),
    })
    return reply
  }

  bootId(): string | undefined {
    return this.linkBootId
  }

  daemonCapabilities(): readonly string[] {
    return this.capabilities
  }

  linked(): boolean {
    return this.link.ready && !this.fenced && !this.closed
  }

  handoff(): void {
    this.detached = true
    this.args.releaseResize()
    this.answers.refuseAll()
    for (const call of [...this.pending.values()]) {
      if (call.done || call.detachOnHandoff !== true) continue
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
    this.cancels.clear()
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

  cancelScope(args: { scope: string }): void {
    sendCancelScope({ link: this.link, epoch: () => this.epoch, scope: args.scope })
  }

  interruptForRestart(args: { reason: string }): void {
    interruptPendingForResize({
      pending: this.pending,
      reason: args.reason,
      cancel: (call) => this.cancels.cancel(call.key),
      settle: (call, result) => this.settle(call, result),
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

  private settle(call: Pending, result: CallResult): void {
    settleCall({ pending: this.pending, call, result })
  }

  private settleError(call: Pending, error: Error): void {
    settleFailed({ pending: this.pending, call, error })
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

  private sink(): FrameSink {
    return frameSinkOf({
      pending: this.pending,
      link: this.link,
      settleAck: (args) => this.acks.settle(args),
      settle: (call, result) => this.settle(call, result),
      settleError: (call, error) => this.settleError(call, error),
      sendRun: (call) => this.sendRun(call),
      failAll: (error) => this.failAll(error),
      handleHelloReply: (frame) => handleHello(this.lane, frame),
      answered: (key, state) => this.answers.settle({ key, state }),
      scopeCancelled: (cancelled) => this.args.onScopeCancelled(cancelled),
      emitEvent: (frame) => {
        this.args.onEvent?.(frame)
      },
    })
  }
}
