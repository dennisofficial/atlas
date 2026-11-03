import { type SteppedCalls, initialCalls, stepCalls } from '@dltech/atlas-core'
import type { CallOp } from '@dltech/atlas-protocol'

import { pruneCalls, readJournal, readOutput, removeCall, writeJournal } from '../journal'
import type { OpHandler, OpRegistry } from '../ops/registry'
import { toJournalRecord } from '../ops/registry'
import { restoreCall } from './restore'

export enum ELedgerError {
  StaleEpoch = 'stale-epoch',
  UnknownKey = 'unknown-key',
  UnsupportedOp = 'unsupported-op',
}

export type LedgerError = { error: ELedgerError; message: string }

export type RunOutcome =
  | { ok: true; state: 'running' }
  | { ok: true; state: 'done'; result: unknown }
  | { ok: false; failure: LedgerError }

export type UnitOutcome = { ok: true } | { ok: false; failure: LedgerError }

export type ReattachOutcome =
  | { ok: true; state: 'running' | 'done'; bytes: Uint8Array }
  | { ok: false; failure: LedgerError }

export type CallSink = {
  chunk(args: { offset: number; bytes: Uint8Array }): void
  result(args: { result: unknown }): void
}

type StreamingExec = Extract<OpHandler, { streams: true }>

export type CallRecord = {
  key: string
  epoch: number
  op: CallOp
  state: 'running' | 'done'
  result?: unknown
}

export type CallLedgerDeps = {
  home: string
  ops: OpRegistry
  env: Record<string, string | undefined>
  onSpawn?: ((count: number) => void) | undefined
}

export class CallLedger {
  private protocol: SteppedCalls
  private spawned = 0
  private readonly calls = new Map<string, CallRecord>()
  private readonly running = new Map<string, { cancel(): void }>()
  private readonly sinksByKey = new Map<string, Set<CallSink>>()

  constructor(
    private readonly deps: CallLedgerDeps,
    bootId: string,
  ) {
    this.protocol = initialCalls({ bootId })
  }

  async boot(): Promise<void> {
    await pruneCalls({ home: this.deps.home })
  }

  hello(args: { epoch: number }): void {
    const { state } = stepCalls({
      state: this.protocol,
      input: { type: 'hello', epoch: args.epoch },
    })
    this.protocol = state
  }

  spawnCount(): number {
    return this.spawned
  }

  async run(args: { key: string; epoch: number; op: CallOp }): Promise<RunOutcome> {
    const stale = this.staleFailure(args)
    if (stale !== null) return { ok: false, failure: stale }

    const answered = this.protocol.calls[args.key]
    const known = this.calls.get(args.key)
    if (known !== undefined) {
      const stepped = stepCalls({
        state: this.protocol,
        input: { type: 'run', key: args.key, dispatched: true, epoch: args.epoch },
      })
      this.protocol = stepped.state
      if (known.state === 'done') return { ok: true, state: 'done', result: known.result }
      return { ok: true, state: 'running' }
    }

    const journaled = await readJournal({ home: this.deps.home, key: args.key })
    if (journaled !== null) {
      const stepped = stepCalls({
        state: this.protocol,
        input: { type: 'run', key: args.key, dispatched: true, epoch: args.epoch },
      })
      this.protocol = stepped.state
      return await this.restore(args)
    }

    const handler = this.deps.ops[args.op.op]
    if (handler === undefined) {
      return {
        ok: false,
        failure: { error: ELedgerError.UnsupportedOp, message: `no handler for ${args.op.op}` },
      }
    }

    const stepped = stepCalls({
      state: this.protocol,
      input: { type: 'run', key: args.key, dispatched: true, epoch: args.epoch },
    })
    this.protocol = stepped.state

    const record: CallRecord = { key: args.key, epoch: args.epoch, op: args.op, state: 'running' }
    await writeJournal({
      home: this.deps.home,
      key: args.key,
      record: toJournalRecord({ record, bytes: 0 }),
    })
    this.calls.set(args.key, record)
    this.start({ handler, record })
    return { ok: true, state: 'running' }
  }

  async ack(args: { key: string; epoch: number }): Promise<UnitOutcome> {
    const stale = this.staleFailure(args)
    if (stale !== null) return { ok: false, failure: stale }
    if (!this.calls.has(args.key)) {
      return {
        ok: false,
        failure: { error: ELedgerError.UnknownKey, message: `unknown key ${args.key}` },
      }
    }
    const stepped = stepCalls({
      state: this.protocol,
      input: { type: 'ack', key: args.key, resultRecorded: true, epoch: args.epoch },
    })
    this.protocol = stepped.state
    this.calls.delete(args.key)
    this.sinksByKey.delete(args.key)
    await removeCall({ home: this.deps.home, key: args.key })
    return { ok: true }
  }

  async cancel(args: { key: string; epoch: number }): Promise<UnitOutcome> {
    const stale = this.staleFailure(args)
    if (stale !== null) return { ok: false, failure: stale }
    const running = this.running.get(args.key)
    if (running === undefined) {
      return {
        ok: false,
        failure: { error: ELedgerError.UnknownKey, message: `not running: ${args.key}` },
      }
    }
    running.cancel()
    return { ok: true }
  }

  async reattach(args: { key: string; epoch: number; offset: number }): Promise<ReattachOutcome> {
    const stale = this.staleFailure(args)
    if (stale !== null) return { ok: false, failure: stale }
    const known = this.calls.get(args.key)
    if (known === undefined) {
      return {
        ok: false,
        failure: { error: ELedgerError.UnknownKey, message: `unknown key ${args.key}` },
      }
    }
    const bytes = await readOutput({ home: this.deps.home, key: args.key, offset: args.offset })
    return { ok: true, state: known.state, bytes }
  }

  subscribe(args: { key: string; sink: CallSink }): void {
    const set = this.sinksByKey.get(args.key) ?? new Set<CallSink>()
    set.add(args.sink)
    this.sinksByKey.set(args.key, set)
  }

  unsubscribe(args: { key: string; sink: CallSink }): void {
    this.sinksByKey.get(args.key)?.delete(args.sink)
  }

  private staleFailure(args: { epoch: number }): LedgerError | null {
    if (args.epoch < this.protocol.epoch) {
      return {
        error: ELedgerError.StaleEpoch,
        message: `epoch ${args.epoch} < ${this.protocol.epoch}`,
      }
    }
    return null
  }

  private async restore(args: { key: string }): Promise<RunOutcome> {
    return await restoreCall(
      {
        home: this.deps.home,
        ops: this.deps.ops,
        epoch: () => this.protocol.epoch,
        start: (startArgs) => this.start(startArgs),
        remember: (record) => this.calls.set(record.key, record),
      },
      args,
    )
  }

  private start(args: { handler: OpHandler; record: CallRecord }): void {
    const { handler, record } = args
    const key = record.key
    if (!handler.streams) {
      void handler
        .run({ op: record.op, home: this.deps.home })
        .then(async (result) => await this.settle({ key, result }))
      return
    }
    void this.startStreaming({ handler, record })
  }

  private async startStreaming(args: {
    handler: StreamingExec
    record: CallRecord
  }): Promise<void> {
    const key = args.record.key
    const cancel = { cancelled: false }
    const execution = await args.handler.exec({
      op: args.record.op,
      ctx: {
        home: this.deps.home,
        key,
        env: this.deps.env,
        cancel,
        noteSpawn: () => {
          this.spawned += 1
          this.deps.onSpawn?.(this.spawned)
        },
        onChunk: async (chunk) => {
          const sinks = this.sinksByKey.get(key)
          if (sinks === undefined) return
          for (const sink of sinks) sink.chunk(chunk)
        },
      },
    })
    this.running.set(key, { cancel: execution.cancel })
    const result = await execution.output
    this.running.delete(key)
    await this.settle({ key, result })
  }

  private async settle(args: { key: string; result: unknown }): Promise<void> {
    const record = this.calls.get(args.key)
    if (record === undefined) return
    record.state = 'done'
    record.result = args.result
    const text = JSON.stringify(args.result)
    const stepped = stepCalls({
      state: this.protocol,
      input: { type: 'exit', key: args.key, result: text },
    })
    this.protocol = stepped.state
    const bytes = (await readOutput({ home: this.deps.home, key: args.key, offset: 0 })).length
    await writeJournal({
      home: this.deps.home,
      key: args.key,
      record: toJournalRecord({ record, bytes }),
    })
    const sinks = this.sinksByKey.get(args.key)
    if (sinks === undefined) return
    for (const sink of sinks) sink.result({ result: args.result })
  }
}
