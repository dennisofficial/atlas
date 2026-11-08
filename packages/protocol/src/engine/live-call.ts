import { EDaemonAnswer, answerCalls, type SteppedCalls } from '@dltech/atlas-core'

import type { CallJournal, CallStore } from './call-store'
import { CALL_JOURNAL_FORMAT, ECallJournalState } from './call-store'
import { CallOutput } from './call-output'
import type { RegisteredOp } from './group'
import { type CallOp, type CallResult, type DaemonEvent, ECallFailure } from '../ops'
import { failedResult, invokeOp } from './results'

export const readJournal = async (args: {
  store: CallStore
  key: string
  onFault(args: { key: string; error: unknown }): void
}): Promise<CallJournal | undefined> => {
  try {
    return await args.store.readState({ key: args.key })
  } catch (error) {
    args.onFault({ key: args.key, error })
    throw error
  }
}

export const discardJournal = async (args: {
  store: CallStore
  key: string
  onFault(args: { key: string; error: unknown }): void
}): Promise<void> => {
  try {
    await args.store.remove({ key: args.key })
  } catch (error) {
    args.onFault({ key: args.key, error })
  }
}

export const answerFor = async (args: {
  state: SteppedCalls
  key: string
  store: CallStore
  onFault(args: { key: string; error: unknown }): void
}): Promise<EDaemonAnswer> => {
  const known = answerCalls({ state: args.state, key: args.key })
  if (known !== EDaemonAnswer.NeverSeen) return known
  const stored = await readJournal({
    store: args.store,
    key: args.key,
    onFault: args.onFault,
  }).catch(() => undefined)
  if (stored === undefined) return EDaemonAnswer.NeverSeen
  return stored.state === ECallJournalState.Done ? EDaemonAnswer.Done : EDaemonAnswer.Running
}

export class ExecutingCalls {
  private readonly promises = new Set<Promise<void>>()

  track(promise: Promise<void>): void {
    this.promises.add(promise)
    const forget = (): boolean => this.promises.delete(promise)
    void promise.then(forget, forget)
  }

  async settled(deadlineMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), deadlineMs)
    })
    try {
      while (this.promises.size > 0) {
        const emptied = Promise.all([...this.promises]).then(() => true)
        if (!(await Promise.race([emptied, expired]))) return false
      }
      return true
    } finally {
      clearTimeout(timer)
    }
  }
}

export class LiveCall {
  readonly abort: AbortController
  readonly output: CallOutput

  constructor(
    private readonly args: {
      key: string
      op: CallOp
      epoch: number
      store: CallStore
      abort: AbortController
      storedBytes?: number | undefined
      onFault(args: { key: string; error: unknown }): void
    },
  ) {
    this.abort = args.abort
    this.output = new CallOutput({
      key: args.key,
      op: args.op.op,
      store: args.store,
      storedBytes: args.storedBytes,
      onFault: ({ error }) => args.onFault({ key: args.key, error }),
    })
  }

  get op(): CallOp {
    return this.args.op
  }

  get epoch(): number {
    return this.args.epoch
  }

  failure(code: ECallFailure, message: string): CallResult {
    return failedResult({ op: this.args.op.op, code, message })
  }

  async journalRunning(): Promise<boolean> {
    try {
      await this.args.store.writeState({
        key: this.args.key,
        journal: {
          format: CALL_JOURNAL_FORMAT,
          state: ECallJournalState.Running,
          epoch: this.args.epoch,
          op: this.args.op,
          outputBytes: 0,
        },
      })
      return true
    } catch (error) {
      this.args.onFault({ key: this.args.key, error })
      return false
    }
  }

  run(handler: RegisteredOp, publish: (event: DaemonEvent) => void): Promise<CallResult> {
    return invokeOp({
      handler,
      op: this.args.op,
      ctx: {
        key: this.args.key,
        signal: this.abort.signal,
        output: (bytes) => this.output.write(bytes),
        publish,
      },
    })
  }

  async persist(result: CallResult, onDone: (result: CallResult) => void): Promise<void> {
    this.output.close()
    await this.output.drain()
    const effective = this.output.lost() ? this.output.lostResult() : result
    try {
      await this.args.store.writeState({
        key: this.args.key,
        journal: {
          format: CALL_JOURNAL_FORMAT,
          state: ECallJournalState.Done,
          epoch: this.args.epoch,
          op: this.args.op,
          outputBytes: this.output.bytes(),
          result: effective,
        },
      })
      onDone(effective)
    } catch (error) {
      this.args.onFault({ key: this.args.key, error })
      onDone(
        this.failure(
          ECallFailure.PersistFailed,
          `the result of ${this.args.key} could not be persisted`,
        ),
      )
    }
  }
}
