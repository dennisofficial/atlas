import {
  ECallError,
  ECallState,
  EDaemonAnswer,
  initialCalls,
  stepCalls,
  type SteppedCalls,
} from '@dltech/atlas-core'

import { EDaemonErrorKind, ERunState } from '../frames'
import { ECallFailure, type CallOp, type CallResult, type DaemonEvent, type OpName } from '../ops'
import type { CallSink } from './call-output'
import { ECallJournalState, type CallJournal, type CallStore } from './call-store'
import type { RegisteredOp } from './group'
import { KeyLock } from './key-lock'
import { LiveCall, answerFor, discardJournal, readJournal } from './live-call'
import { type LedgerOutcome, refused, staleEpoch, unknownKey } from './outcomes'
import { interruptedByRestart } from './results'
import { RunArrivals } from './run-arrivals'

export type { LedgerOutcome } from './outcomes'

export type CallRunArgs = {
  key: string
  epoch: number
  op: CallOp
  owner: object
  sink: CallSink
  fromOffset: number
  onReply(state: ERunState): void
}

export type CallLedgerArgs = {
  store: CallStore
  bootId: string
  ops: ReadonlyMap<OpName, RegisteredOp>
  publish(event: DaemonEvent): void
  onFault(args: { key: string; error: unknown }): void
  onRunning(promise: Promise<void>): void
}

export class CallLedger {
  private protocol: SteppedCalls
  private runs = 0
  private readonly lock = new KeyLock()
  private readonly calls = new Map<string, LiveCall>()
  private readonly arrivals = new RunArrivals()

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

  run(args: CallRunArgs): Promise<LedgerOutcome> {
    const arrival = this.arrivals.arrive(args.key)
    const outcome = this.lock.run<LedgerOutcome>({
      key: args.key,
      task: async () => {
        const stepRun = () =>
          stepCalls({
            state: this.protocol,
            input: { type: 'run', key: args.key, dispatched: true, epoch: args.epoch },
          })
        let stepped = stepRun()
        if (stepped.effects.errors.includes(ECallError.StaleEpoch)) return staleEpoch(args.epoch)
        const spawns = stepped.effects.spawned.includes(args.key)
        if (spawns) {
          let stored: CallJournal | undefined
          try {
            stored = await this.readStored(args.key)
          } catch {
            return refused({
              errorKind: EDaemonErrorKind.Internal,
              message: `the journal of ${args.key} could not be read`,
            })
          }
          stepped = stepRun()
          if (stepped.effects.errors.includes(ECallError.StaleEpoch)) return staleEpoch(args.epoch)
          if (stored !== undefined) {
            this.protocol = stepped.state
            return await this.adopt({ ...args, stored })
          }
        }
        const handler = this.args.ops.get(args.op.op)
        if (spawns && handler === undefined) {
          return refused({
            errorKind: EDaemonErrorKind.InvalidFrame,
            message: `this daemon has no ${args.op.op} op`,
          })
        }
        this.protocol = stepped.state
        if (spawns && handler !== undefined) {
          const started = await this.spawn({ ...args, handler, arrival })
          if (!started.ok) return started
        }
        const call = this.calls.get(args.key)
        if (call === undefined) return unknownKey(args.key)
        args.onReply(spawns || this.isRunning(args.key) ? ERunState.Running : ERunState.Done)
        call.output.attach({ owner: args.owner, sink: args.sink, fromOffset: args.fromOffset })
        return { ok: true }
      },
    })
    return outcome.finally(() => this.arrivals.leave(args.key))
  }

  answer(args: { key: string }): Promise<EDaemonAnswer> {
    return this.lock.run({
      key: args.key,
      task: () =>
        answerFor({
          state: this.protocol,
          key: args.key,
          store: this.args.store,
          onFault: this.args.onFault,
        }),
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
        this.arrivals.forget(args.key)
        await call?.output.drain()
        await this.discard(args.key)
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
    if (call === undefined) {
      if (!this.arrivals.isWaiting(args.key)) return unknownKey(args.key)
      this.arrivals.cancel(args.key)
      return { ok: true }
    }
    if (!stepped.effects.cancelled.includes(args.key)) return { ok: true }
    this.arrivals.cancel(args.key)
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

  private readStored(key: string): Promise<CallJournal | undefined> {
    return readJournal({ store: this.args.store, key, onFault: this.args.onFault })
  }

  private discard(key: string): Promise<void> {
    return discardJournal({ store: this.args.store, key, onFault: this.args.onFault })
  }

  private async adopt(args: CallRunArgs & { stored: CallJournal }): Promise<LedgerOutcome> {
    const call = new LiveCall({
      key: args.key,
      op: args.op,
      epoch: args.epoch,
      store: this.args.store,
      abort: new AbortController(),
      storedBytes: args.stored.outputBytes,
      onFault: this.args.onFault,
    })
    this.calls.set(args.key, call)
    if (args.stored.state === ECallJournalState.Done) {
      call.output.close()
      this.settle({ key: args.key, call, result: args.stored.result })
    } else {
      await call.persist(interruptedByRestart(args.op.op), (result) =>
        this.settle({ key: args.key, call, result }),
      )
    }
    args.onReply(this.isRunning(args.key) ? ERunState.Running : ERunState.Done)
    call.output.attach({ owner: args.owner, sink: args.sink, fromOffset: args.fromOffset })
    return { ok: true }
  }

  private async spawn(
    args: CallRunArgs & { handler: RegisteredOp; arrival: number },
  ): Promise<LedgerOutcome> {
    const call = new LiveCall({
      key: args.key,
      op: args.op,
      epoch: args.epoch,
      store: this.args.store,
      abort: this.arrivals.controllerFor({ key: args.key, arrival: args.arrival }),
      onFault: this.args.onFault,
    })
    this.calls.set(args.key, call)
    if (!(await call.journalRunning())) {
      const message = 'the call journal could not be written'
      this.settle({
        key: args.key,
        call,
        result: call.failure(ECallFailure.PersistFailed, message),
      })
      return { ok: true }
    }
    if (this.protocol.epoch > args.epoch) {
      await this.abandon({ key: args.key })
      return staleEpoch(args.epoch)
    }
    if (call.abort.signal.aborted) {
      const message = `${args.key} was cancelled before it started`
      void call.persist(call.failure(ECallFailure.Cancelled, message), (result) =>
        this.settle({ key: args.key, call, result }),
      )
      return { ok: true }
    }
    this.runs += 1
    const running: Promise<void> = this.execute({
      key: args.key,
      call,
      handler: args.handler,
    }).catch((error: unknown) => this.args.onFault({ key: args.key, error }))
    this.args.onRunning(running)
    return { ok: true }
  }

  private async abandon(args: { key: string }): Promise<void> {
    this.protocol = stepCalls({
      state: this.protocol,
      input: { type: 'abandon', key: args.key },
    }).state
    this.calls.delete(args.key)
    await this.discard(args.key)
  }

  private async execute(args: {
    key: string
    call: LiveCall
    handler: RegisteredOp
  }): Promise<void> {
    const { call } = args
    const result = await call.run(args.handler, this.args.publish)
    await this.lock.run({
      key: args.key,
      task: () =>
        call.persist(result, (done) => this.settle({ key: args.key, call, result: done })),
    })
  }

  private settle(args: { key: string; call: LiveCall; result: CallResult }): void {
    this.protocol = stepCalls({
      state: this.protocol,
      input: { type: 'exit', key: args.key, result: JSON.stringify(args.result) },
    }).state
    this.arrivals.forget(args.key)
    args.call.output.end({ result: args.result })
  }
}
