import { z } from 'zod'

import { callOpSchema, callResultSchema, type CallOp, type CallResult } from '../ops'

export enum ECallJournalState {
  Running = 'running',
  Done = 'done',
}

export const CALL_JOURNAL_FORMAT = 1

type CallJournalFields = {
  format: typeof CALL_JOURNAL_FORMAT
  epoch: number
  op: CallOp
  outputBytes: number
}

export type CallJournal =
  | (CallJournalFields & { state: ECallJournalState.Running })
  | (CallJournalFields & { state: ECallJournalState.Done; result: CallResult })

const REDACTED = '[redacted]'

export const journalOp = (op: CallOp): CallOp =>
  op.op === 'previews.expose' ? { ...op, tunnelToken: REDACTED } : op

const journalFields = {
  format: z.literal(CALL_JOURNAL_FORMAT),
  epoch: z.number().int().min(0),
  op: callOpSchema,
  outputBytes: z.number().int().min(0),
}

export const callJournalSchema = z.discriminatedUnion('state', [
  z.object({ ...journalFields, state: z.literal(ECallJournalState.Running) }),
  z.object({
    ...journalFields,
    state: z.literal(ECallJournalState.Done),
    result: callResultSchema,
  }),
])

export const parseCallJournal = (value: unknown): CallJournal | undefined => {
  const parsed = callJournalSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export type CallStore = {
  prune(): Promise<void>
  readState(args: { key: string }): Promise<CallJournal | undefined>
  writeState(args: { key: string; journal: CallJournal }): Promise<void>
  appendOutput(args: { key: string; bytes: Uint8Array }): Promise<void>
  readOutput(args: { key: string; offset: number }): Promise<Uint8Array>
  remove(args: { key: string }): Promise<void>
}

type MemoryCall = { journal: CallJournal; output: Uint8Array[] }

const concat = (chunks: readonly Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const joined = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    joined.set(chunk, at)
    at += chunk.length
  }
  return joined
}

export class MemoryCallStore implements CallStore {
  private readonly calls = new Map<string, MemoryCall>()

  async prune(): Promise<void> {
    return Promise.resolve()
  }

  async readState(args: { key: string }): Promise<CallJournal | undefined> {
    return this.calls.get(args.key)?.journal
  }

  async writeState(args: { key: string; journal: CallJournal }): Promise<void> {
    const existing = this.calls.get(args.key)
    this.calls.set(args.key, { journal: args.journal, output: existing?.output ?? [] })
  }

  async appendOutput(args: { key: string; bytes: Uint8Array }): Promise<void> {
    const call = this.calls.get(args.key)
    if (call === undefined) throw new Error(`no journal for ${args.key}`)
    call.output.push(new Uint8Array(args.bytes))
  }

  async readOutput(args: { key: string; offset: number }): Promise<Uint8Array> {
    const call = this.calls.get(args.key)
    if (call === undefined) return new Uint8Array()
    return concat(call.output).subarray(args.offset)
  }

  async remove(args: { key: string }): Promise<void> {
    this.calls.delete(args.key)
  }

  journalOf(key: string): CallJournal | undefined {
    return this.calls.get(key)?.journal
  }

  snapshot(): MemoryCallStore {
    const copy = new MemoryCallStore()
    for (const [key, call] of this.calls) {
      copy.calls.set(key, { journal: call.journal, output: [...call.output] })
    }
    return copy
  }
}
