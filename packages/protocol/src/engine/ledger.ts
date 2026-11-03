import {
  ECallError,
  ECallState,
  initialCalls,
  stepCalls,
  type SteppedCalls,
} from '@dltech/atlas-core'

import { EDaemonErrorKind, ERunState } from '../frames'
import { ECallFailure, type CallOp, type CallResult, type DaemonEvent, type OpName } from '../ops'
import { CallOutput, type CallSink } from './call-output'
import { ECallJournalState, type CallStore } from './call-store'
import type { RegisteredOp } from './group'
import { KeyLock } from './key-lock'
import { type LedgerOutcome, refused, staleEpoch, unknownKey } from './outcomes'
import { failedResult, invokeOp } from './results'

export type { LedgerOutcome } from './outcomes'

type LiveCall = { op: CallOp; epoch: number; output: CallOutput; abort: AbortController }

export type CallLedgerArgs = {
  store: CallStore
  bootId: string
  ops: ReadonlyMap<OpName, RegisteredOp>
  publish(event: DaemonEvent): void
  onFault(args: { key: string; error: unknown }): void
}

export class CallLedger {
  private protocol: SteppedCalls
  private runs = 0
  private readonly lock = new KeyLock()
  private readonly calls = new Map<string, LiveCall>()
  private arrivals = 0
  private readonly cancelledThrough = new Map<string, number>()

  constructor(private readonly args: CallLedgerArgs) {
    this.protocol = initialCalls({ bootId: args.bootId })
  }

  async open(): Promise<void> {
    await this.args.store.prune()
  }

  runCount(): number {
    return this.runs
  }

  hello(args: { epoch: number }): LedgerOutcome {
    const stepped = stepCalls({ state: this.protocol, input: { type: 'hello', epoch: args.epoch } })
    if (stepped.effects.errors.includes(ECallError.StaleEpoch)) return staleEpoch(args.epoch)
    this.protocol = stepped.state
    return { ok: true }
  }

  run(args: {
    key: string
    epoch: number
    op: CallOp
    owner: object
    sink: CallSink
    fromOffset: number
    onReply(state: ERunState): void
  }): Promise<LedgerOutcome> {
    this.arrivals += 1
    const arrival = this.arrivals
    return this.lock.run({
      key: args.key,
      task: async () => {
        const stepped = stepCalls({
          state: this.protocol,
          input: { type: 'run', key: args.key, dispatched: true, epoch: args.epoch },
        })
        if (stepped.effects.errors.includes(ECallError.StaleEpoch)) return staleEpoch(args.epoch)
        const spawns = stepped.effects.spawned.includes(args.key)
        const handler = this.args.ops.get(args.op.op)
        if (spawns && handler === undefined) {
          return refused({
            errorKind: EDaemonErrorKind.InvalidFrame,
            message: `this daemon has no ${args.op.op} op`,
          })
        }
        this.protocol = stepped.state
        if (spawns && handler !== undefined) {
          const started = await this.spawn({
            key: args.key,
            epoch: args.epoch,
            op: args.op,
            handler,
            arrival,
          })
          if (!started.ok) return started
        }
        const call = this.calls.get(args.key)
        if (call === undefined) return unknownKey(args.key)
        args.onReply(spawns || this.isRunning(args.key) ? ERunState.Running : ERunState.Done)
        call.output.attach({ owner: args.owner, sink: args.sink, fromOffset: args.fromOffset })
        return { ok: true }
      },
    })
  }

  ack(args: { key: string; epoch: number }): Promise<LedgerOutcome> {
    return this.lock.run({
      key: args.key,
      task: async () => {
        const stepped = stepCalls({
          state: this.protocol,
          input: { type: 'ack', key: args.key, resultRecorded: true, epoch: args.epoch },
        })
        if (stepped.effects.errors.includes(ECallError.StaleEpoch)) return staleEpoch(args.epoch)
        if (!this.calls.has(args.key)) return unknownKey(args.key)
        if (!stepped.effects.deleted.includes(args.key)) {
          return refused({
            errorKind: EDaemonErrorKind.NotDone,
            message: `${args.key} is still running`,
          })
        }
        const call = this.calls.get(args.key)
        this.protocol = stepped.state
        this.calls.delete(args.key)
        this.cancelledThrough.delete(args.key)
        await call?.output.drain()
        try {
          await this.args.store.remove({ key: args.key })
        } catch (error) {
          this.args.onFault({ key: args.key, error })
        }
        return { ok: true }
      },
    })
  }

  cancel(args: { key: string; epoch: number }): LedgerOutcome {
    const stepped = stepCalls({
      state: this.protocol,
      input: { type: 'cancel', key: args.key, epoch: args.epoch },
    })
    if (stepped.effects.errors.includes(ECallError.StaleEpoch)) return staleEpoch(args.epoch)
    const call = this.calls.get(args.key)
    if (call === undefined) return unknownKey(args.key)
    if (!stepped.effects.cancelled.includes(args.key)) return { ok: true }
    this.cancelledThrough.set(args.key, this.arrivals)
    call.abort.abort()
    return { ok: true }
  }

  detachOwner(args: { owner: object }): void {
    for (const call of this.calls.values()) call.output.detach({ owner: args.owner })
  }

  abortAll(): void {
    for (const call of this.calls.values()) call.abort.abort()
  }

  private isRunning(key: string): boolean {
    return this.protocol.calls[key] === ECallState.Running
  }

  private async spawn(args: {
    key: string
    epoch: number
    op: CallOp
    handler: RegisteredOp
    arrival: number
  }): Promise<LedgerOutcome> {
    const call: LiveCall = {
      op: args.op,
      epoch: args.epoch,
      abort: this.controllerFor({ key: args.key, arrival: args.arrival }),
      output: new CallOutput({
        key: args.key,
        op: args.op.op,
        store: this.args.store,
        onFault: ({ error }) => this.args.onFault({ key: args.key, error }),
      }),
    }
    this.calls.set(args.key, call)
    try {
      await this.args.store.writeState({
        key: args.key,
        journal: {
          state: ECallJournalState.Running,
          epoch: args.epoch,
          op: args.op,
          outputBytes: 0,
        },
      })
    } catch (error) {
      this.args.onFault({ key: args.key, error })
      const message = 'the call journal could not be written'
      this.settle({
        key: args.key,
        call,
        result: this.failure({ call, code: ECallFailure.PersistFailed, message }),
      })
      return { ok: true }
    }
    if (this.protocol.epoch > args.epoch) {
      await this.abandon({ key: args.key })
      return staleEpoch(args.epoch)
    }
    if (call.abort.signal.aborted) {
      const message = `${args.key} was cancelled before it started`
      void this.finish({
        key: args.key,
        call,
        result: this.failure({ call, code: ECallFailure.Cancelled, message }),
      })
      return { ok: true }
    }
    this.runs += 1
    void this.execute({ key: args.key, call, handler: args.handler })
    return { ok: true }
  }

  private controllerFor(args: { key: string; arrival: number }): AbortController {
    const controller = new AbortController()
    if (args.arrival <= (this.cancelledThrough.get(args.key) ?? 0)) controller.abort()
    return controller
  }

  private async abandon(args: { key: string }): Promise<void> {
    this.protocol = stepCalls({
      state: this.protocol,
      input: { type: 'abandon', key: args.key },
    }).state
    this.calls.delete(args.key)
    try {
      await this.args.store.remove({ key: args.key })
    } catch (error) {
      this.args.onFault({ key: args.key, error })
    }
  }

  private failure(args: { call: LiveCall; code: ECallFailure; message: string }): CallResult {
    return failedResult({ op: args.call.op.op, code: args.code, message: args.message })
  }

  private async execute(args: {
    key: string
    call: LiveCall
    handler: RegisteredOp
  }): Promise<void> {
    const { call } = args
    const result = await invokeOp({
      handler: args.handler,
      op: call.op,
      ctx: {
        key: args.key,
        signal: call.abort.signal,
        output: (bytes) => call.output.write(bytes),
        publish: (event) => this.args.publish(event),
      },
    })
    await this.lock.run({ key: args.key, task: () => this.finish({ key: args.key, call, result }) })
  }

  private async finish(args: { key: string; call: LiveCall; result: CallResult }): Promise<void> {
    const { call } = args
    call.output.close()
    await call.output.drain()
    const result = call.output.lost() ? call.output.lostResult() : args.result
    try {
      await this.args.store.writeState({
        key: args.key,
        journal: {
          state: ECallJournalState.Done,
          epoch: call.epoch,
          op: call.op,
          outputBytes: call.output.bytes(),
          result,
        },
      })
    } catch (error) {
      this.args.onFault({ key: args.key, error })
      const message = `the result of ${args.key} could not be persisted`
      this.settle({
        key: args.key,
        call,
        result: this.failure({ call, code: ECallFailure.PersistFailed, message }),
      })
      return
    }
    this.settle({ key: args.key, call, result })
  }

  private settle(args: { key: string; call: LiveCall; result: CallResult }): void {
    this.protocol = stepCalls({
      state: this.protocol,
      input: { type: 'exit', key: args.key, result: JSON.stringify(args.result) },
    }).state
    this.cancelledThrough.delete(args.key)
    args.call.output.end({ result: args.result })
  }
}
