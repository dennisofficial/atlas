import { describe, expect, it } from 'bun:test'

import {
  ECallFailure,
  ECallStatus,
  EExecOutcome,
  type CallOp,
  type CallResult,
  type OpName,
} from '../../ops'
import { ECallJournalState, MemoryCallStore, type CallJournal } from '../call-store'
import { defineOp, type RegisteredOp } from '../group'
import { CallLedger } from '../ledger'

const OP: CallOp = { op: 'exec', argv: ['work'] }

class GatedStore extends MemoryCallStore {
  readonly stateGate = Promise.withResolvers<void>()
  stateEntered = false

  override async readState(args: { key: string }): Promise<CallJournal | undefined> {
    this.stateEntered = true
    await this.stateGate.promise
    return super.readState(args)
  }
}

const waitFor = async (want: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 400 && !want(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  if (!want()) throw new Error('timed out')
}

describe('cancel-scope over an arrival', () => {
  it('answers only after the cancelled-before-start arrival wrote its journal', async () => {
    const store = new GatedStore()
    let started = false
    const exec = defineOp({
      op: 'exec',
      run: async () => {
        started = true
        return { exitCode: 0, signal: null, outcome: EExecOutcome.Exited, outputBytes: 0 }
      },
    })
    const ledger = new CallLedger({
      store,
      bootId: 'boot',
      ops: new Map<OpName, RegisteredOp>([['exec', exec]]),
      publish: () => {},
      onFault: () => {},
      onRunning: () => {},
    })
    const results: CallResult[] = []
    const running = ledger.run({
      key: 'A.0',
      epoch: 1,
      op: OP,
      owner: {},
      sink: { output: () => {}, result: ({ result }) => void results.push(result) },
      fromOffset: 0,
      onReply: () => {},
    })
    await waitFor(() => store.stateEntered)

    const cancelled = ledger.cancelScope({ scope: 'A', epoch: 1 })
    expect(results).toEqual([])
    store.stateGate.resolve()
    const outcome = await cancelled

    expect(outcome).toEqual({ ok: true, cancelled: ['A.0'] })
    expect(started).toBe(false)
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe(ECallStatus.Failed)
    if (results[0]?.status === ECallStatus.Failed)
      expect(results[0].error.code).toBe(ECallFailure.Cancelled)
    expect((await store.readState({ key: 'A.0' }))?.state).toBe(ECallJournalState.Done)
    await running
  })
})
