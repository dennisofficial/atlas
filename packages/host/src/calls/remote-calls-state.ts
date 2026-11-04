import type { LogPort } from '@dltech/atlas-observability'
import { ECallFailure } from '@dltech/atlas-protocol'
import type { CallOp, CallResult } from '@dltech/atlas-protocol'

import {
  FencedError,
  ProtocolViolationError,
  SandboxUnavailableError,
  actionForLostCall,
} from './errors'
import { DaemonLink } from './link'
import {
  failedResult,
  handedOffResult,
  handleDaemonFrame,
  interruptedResult,
  recoverRestartedCalls,
  rejectPending,
  type Pending,
  type Waiter,
} from './remote-calls-frames'
import type { RemoteCallsArgs } from './remote-calls'

export class RemoteCallsState {
  private readonly pending = new Map<string, Pending>()
  private readonly pendingAcks = new Map<string, { key: string; resolve(found: boolean): void }>()
  private readonly link: DaemonLink
  private readonly log: LogPort | undefined

  private epoch = 0
  private linkBootId: string | undefined
  private fenced = false
  private closed = false
  private detached = false
  private availability: SandboxUnavailableError | null = null
  private readyResolve: ((reply: { bootId: string; version: string }) => void) | null = null
  private readyReject: ((error: Error) => void) | null = null
  private readonly readyPromise: Promise<{ bootId: string; version: string }>

  constructor(private readonly args: RemoteCallsArgs) {
    this.log = args.log
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
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

  ready(): Promise<{ bootId: string; version: string }> {
    return this.readyPromise
  }

  bootId(): string | undefined {
    return this.linkBootId
  }

  handoff(): void {
    this.detached = true
    for (const call of [...this.pending.values()]) {
      if (call.done) continue
      this.settle(call, handedOffResult(call))
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.link.teardown()
    const error = new FencedError(`session ${this.args.sessionId} closed its daemon link`)
    rejectPending({ pending: this.pending, pendingAcks: this.pendingAcks, error })
    const readyReject = this.readyReject
    this.readyResolve = null
    this.readyReject = null
    if (readyReject !== null) queueMicrotask(() => readyReject(error))
  }

  async invoke(args: {
    key: string
    op: CallOp
    signal?: AbortSignal | undefined
    onOutput?: ((bytes: Uint8Array) => void) | undefined
    dispatchedBootId?: string | undefined
  }): Promise<CallResult> {
    if (this.fenced) throw new FencedError(`session ${this.args.sessionId} lost its lease`)
    if (this.availability !== null) throw this.availability
    if (this.closed) {
      throw new FencedError(`session ${this.args.sessionId} closed its daemon link`)
    }
    const waiter: Waiter = { settle: () => {}, onOutput: args.onOutput }
    const outcome = new Promise<CallResult>((resolve, reject) => {
      waiter.settle = resolve
      waiter.reject = reject
    })
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
    }
    if (!this.detached) call.waiters.push(waiter)
    if (args.signal !== undefined) this.attachSignal({ call, signal: args.signal })
    this.pending.set(args.key, call)
    try {
      await this.readyPromise
    } catch (error) {
      this.pending.delete(args.key)
      waiter.detach?.()
      throw error
    }
    if (this.lostAcrossBoot(call, args.dispatchedBootId)) {
      this.settle(call, interruptedResult(args.op.op))
      return outcome
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

  private ackKey(args: { key: string }): Promise<boolean> {
    if (this.fenced || this.closed) return Promise.resolve(false)
    return new Promise<boolean>((resolve, reject) => {
      this.readyPromise.then(
        () => {
          if (this.fenced) {
            resolve(false)
            return
          }
          this.pendingAcks.set(args.key, { key: args.key, resolve })
          if (this.link.ready) this.link.send({ kind: 'ack', key: args.key, epoch: this.epoch })
        },
        () => {
          if (this.fenced || this.closed) {
            resolve(false)
            return
          }
          reject(new ProtocolViolationError('the daemon link failed before the ack could be sent'))
        },
      )
    })
  }

  private lostAcrossBoot(call: Pending, dispatchedBootId: string | undefined): boolean {
    if (dispatchedBootId === undefined || this.linkBootId === undefined) return false
    if (dispatchedBootId === this.linkBootId) return false
    return !actionForLostCall({
      op: call.op.op,
      dispatchedBootId,
      currentBootId: this.linkBootId,
    }).rerun
  }

  private attachSignal(args: { call: Pending; signal: AbortSignal }): void {
    const onAbort = (): void => {
      if (this.detached) return
      args.call.controller.abort()
      if (args.call.sent && this.link.ready) {
        this.link.send({ kind: 'cancel', key: args.call.key, epoch: this.epoch })
      }
    }
    args.signal.addEventListener('abort', onAbort, { once: true })
    args.call.detach = () => args.signal.removeEventListener('abort', onAbort)
    if (args.signal.aborted) onAbort()
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
    this.link.ready = true
    this.readyResolve?.(frame)
    this.readyResolve = null
    this.readyReject = null
    for (const ack of this.pendingAcks.values()) {
      this.link.send({ kind: 'ack', key: ack.key, epoch: this.epoch })
    }
    if (restart) this.recoverAcrossRestart(previousBootId)
    for (const call of this.pending.values()) {
      if (call.done) continue
      this.sendRun(call)
    }
    this.link.schedulePing()
  }

  private recoverAcrossRestart(previousBootId: string): void {
    recoverRestartedCalls({
      state: this.sink(),
      previousBootId,
      currentBootId: this.linkBootId ?? previousBootId,
    })
  }

  private failAll(error: Error): void {
    if (error instanceof SandboxUnavailableError) this.availability = error
    this.link.teardown()
    this.readyReject?.(error)
    this.readyResolve = null
    this.readyReject = null
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
      recoverAcrossRestart: (bootId: string) => this.recoverAcrossRestart(bootId),
    }
  }
}
