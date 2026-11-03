import {
  ECallError,
  ECallState,
  initialCalls,
  stepCalls,
  type SteppedCalls,
} from '@dltech/atlas-core'

import { EDaemonErrorKind, ERunState } from '../frames'
import {
  ECallFailure,
  ECallStatus,
  callFailureOf,
  okCallResultSchema,
  type CallFailure,
  type CallOp,
  type CallResult,
  type DaemonEvent,
  type OpName,
} from '../ops'
import { CallOutput, type CallSink } from './call-output'
import { ECallJournalState, type CallStore } from './call-store'
import type { RegisteredOp } from './group'
import { KeyLock } from './key-lock'

export type LedgerOutcome =
  | { ok: true }
  | { ok: false; errorKind: EDaemonErrorKind; message: string }

type LiveCall = { op: CallOp; epoch: number; output: CallOutput; abort: AbortController }

const refused = (args: { errorKind: EDaemonErrorKind; message: string }): LedgerOutcome => ({
  ok: false,
  ...args,
})

const staleEpoch = (epoch: number): LedgerOutcome =>
  refused({ errorKind: EDaemonErrorKind.StaleEpoch, message: `epoch ${epoch} is stale` })

const unknownKey = (key: string): LedgerOutcome =>
  refused({ errorKind: EDaemonErrorKind.UnknownKey, message: `unknown key ${key}` })

const failedResult = (args: { op: CallOp; error: CallFailure }): CallResult => ({
  status: ECallStatus.Failed,
  op: args.op.op,
  error: args.error,
})

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
          await this.spawn({ key: args.key, epoch: args.epoch, op: args.op, handler })
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
        this.protocol = stepped.state
        this.calls.delete(args.key)
        try {
          await this.args.store.remove({ key: args.key })
        } catch (error) {
          this.args.onFault({ key: args.key, error })
        }
        return { ok: true }
      },
    })
  }

  cancel(args: { key: string; epoch: number }): Promise<LedgerOutcome> {
    return this.lock.run({
      key: args.key,
      task: async () => {
        const stepped = stepCalls({
          state: this.protocol,
          input: { type: 'cancel', key: args.key, epoch: args.epoch },
        })
        if (stepped.effects.errors.includes(ECallError.StaleEpoch)) return staleEpoch(args.epoch)
        const call = this.calls.get(args.key)
        if (call === undefined) return unknownKey(args.key)
        if (stepped.effects.cancelled.includes(args.key)) call.abort.abort()
        return { ok: true }
      },
    })
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
  }): Promise<void> {
    const call: LiveCall = {
      op: args.op,
      epoch: args.epoch,
      abort: new AbortController(),
      output: new CallOutput({
        key: args.key,
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
      const failure = {
        code: ECallFailure.Internal,
        message: 'the call journal could not be written',
      }
      this.settle({ key: args.key, call, result: failedResult({ op: args.op, error: failure }) })
      return
    }
    this.runs += 1
    void this.execute({ key: args.key, call, handler: args.handler })
  }

  private async execute(args: {
    key: string
    call: LiveCall
    handler: RegisteredOp
  }): Promise<void> {
    const result = await this.invoke(args)
    args.call.output.close()
    await args.call.output.drain()
    await this.lock.run({
      key: args.key,
      task: async () => {
        try {
          await this.args.store.writeState({
            key: args.key,
            journal: {
              state: ECallJournalState.Done,
              epoch: args.call.epoch,
              op: args.call.op,
              outputBytes: args.call.output.bytes(),
              result,
            },
          })
        } catch (error) {
          this.args.onFault({ key: args.key, error })
        }
        this.settle({ key: args.key, call: args.call, result })
      },
    })
  }

  private async invoke(args: {
    key: string
    call: LiveCall
    handler: RegisteredOp
  }): Promise<CallResult> {
    const { call } = args
    try {
      const value = await args.handler.run({
        op: call.op,
        ctx: {
          key: args.key,
          signal: call.abort.signal,
          output: (bytes) => call.output.write(bytes),
          publish: (event) => this.args.publish(event),
        },
      })
      const parsed = okCallResultSchema.safeParse({ status: ECallStatus.Ok, op: call.op.op, value })
      if (parsed.success) return parsed.data
      const message = `${call.op.op} returned an invalid value: ${parsed.error.message}`
      return failedResult({ op: call.op, error: { code: ECallFailure.Internal, message } })
    } catch (error) {
      return failedResult({ op: call.op, error: callFailureOf(error) })
    }
  }

  private settle(args: { key: string; call: LiveCall; result: CallResult }): void {
    this.protocol = stepCalls({
      state: this.protocol,
      input: { type: 'exit', key: args.key, result: JSON.stringify(args.result) },
    }).state
    args.call.output.end({ result: args.result })
  }
}
