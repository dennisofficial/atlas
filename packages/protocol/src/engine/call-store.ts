import type { CallOp, CallResult } from '../ops'

export enum ECallJournalState {
  Running = 'running',
  Done = 'done',
}

export type CallJournal = {
  state: ECallJournalState
  epoch: number
  op: CallOp
  outputBytes: number
  result?: CallResult | undefined
}

export type CallStore = {
  prune(): Promise<void>
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
    this.calls.clear()
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
}
