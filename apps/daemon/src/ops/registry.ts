import type { CallOp } from '@dltech/atlas-protocol'

import type { CallJournalState, JournalRecord } from '../journal'

export type OpKind = CallOp['op']

export type OpChunk = { bytes: Uint8Array; offset: number }

export type OpExecContext = {
  home: string
  key: string
  env: Record<string, string | undefined>
  cancel: { cancelled: boolean }
  onChunk(args: OpChunk): Promise<void>
  noteSpawn(): void
}

export type OpExecution = { output: Promise<unknown>; cancel(): void }

export type OpHandler =
  | { streams: false; run(args: { op: CallOp; home: string }): Promise<unknown> }
  | { streams: true; exec(args: { op: CallOp; ctx: OpExecContext }): Promise<OpExecution> }

export type OpRegistry = Partial<Record<OpKind, OpHandler>>

export type CallRecord = {
  key: string
  epoch: number
  op: CallOp
  state: CallJournalState
  result?: unknown
}

export const toJournalRecord = (args: { record: CallRecord; bytes: number }): JournalRecord => ({
  state: args.record.state,
  epoch: args.record.epoch,
  op: args.record.op,
  bytes: args.bytes,
  ...(args.record.result === undefined ? {} : { result: args.record.result }),
})
