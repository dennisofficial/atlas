import { describe, expect, it } from 'bun:test'

import { EExecOutcome, type CallOp, type CallResult, type OpName } from '../../ops'
import { MemoryCallStore, type CallJournal } from '../call-store'
import { defineOp, type RegisteredOp } from '../group'
import { CallLedger } from '../ledger'

const OP: CallOp = { op: 'exec', argv: ['work'] }

class GatedReadStore extends MemoryCallStore {
  private readonly held = new Map<string, Promise<void>>()

  holdReadOf(args: { key: string; until: Promise<void> }): void {
    this.held.set(args.key, args.until)
  }

  override async readState(args: { key: string }): Promise<CallJournal | undefined> {
    await this.held.get(args.key)
    return super.readState(args)
  }
}

const settledResult = (): {
  results: CallResult[]
  sink: { output(): void; result(args: { result: CallResult }): void }
} => {
  const results: CallResult[] = []
  return {
    results,
    sink: { output: () => {}, result: ({ result }) => void results.push(result) },
  }
}

const waitFor = async (want: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 400 && !want(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  if (!want()) throw new Error('timed out')
}

describe('CallLedger with overlapping runs on different keys', () => {
  it('keeps the exit of a call that finished while another run read its journal', async () => {
    const store = new GatedReadStore()
    const exec = defineOp({
      op: 'exec',
      run: async () => ({
        exitCode: 0,
        signal: null,
        outcome: EExecOutcome.Exited,
        outputBytes: 0,
      }),
    })
    const ledger = new CallLedger({
      store,
      bootId: 'boot',
      ops: new Map<OpName, RegisteredOp>([['exec', exec]]),
      publish: () => {},
      onFault: () => {},
      onRunning: () => {},
    })
    const release = Promise.withResolvers<void>()
    store.holdReadOf({ key: 'second', until: release.promise })
    const first = settledResult()
    const second = settledResult()
    const runOf = (args: { key: string; sink: ReturnType<typeof settledResult>['sink'] }) =>
      ledger.run({
        key: args.key,
        epoch: 1,
        op: OP,
        owner: {},
        sink: args.sink,
        fromOffset: 0,
        onReply: () => {},
      })

    await runOf({ key: 'first', sink: first.sink })
    const parked = runOf({ key: 'second', sink: second.sink })
    await waitFor(() => first.results.length === 1)
    release.resolve()
    await parked
    await waitFor(() => second.results.length === 1)

    expect(await ledger.ack({ key: 'first', epoch: 1 })).toEqual({ ok: true })
    expect(await ledger.ack({ key: 'second', epoch: 1 })).toEqual({ ok: true })
  })
})
