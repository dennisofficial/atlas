import { describe, expect, it } from 'bun:test'

import {
  ECallFailure,
  ECallStatus,
  EExecOutcome,
  type CallOp,
  type CallResult,
  type OpName,
} from '../../ops'
import { CallOutput } from '../call-output'
import { MemoryCallStore, type CallJournal } from '../call-store'
import { defineOp, type RegisteredOp } from '../group'
import { CallLedger } from '../ledger'

const OP: CallOp = { op: 'exec', argv: ['work'] }

class GatedStore extends MemoryCallStore {
  readonly stateGate = Promise.withResolvers<void>()
  readonly outputGate = Promise.withResolvers<void>()
  stateEntered = false
  outputEntered = false

  override async readState(args: { key: string }): Promise<CallJournal | undefined> {
    this.stateEntered = true
    await this.stateGate.promise
    return super.readState(args)
  }

  override async readOutput(args: { key: string; offset: number }): Promise<Uint8Array> {
    this.outputEntered = true
    await this.outputGate.promise
    return super.readOutput(args)
  }
}

const waitFor = async (want: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 400 && !want(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  if (!want()) throw new Error('timed out')
}

describe('daemon engine interleavings', () => {
  it('cancels a run that is still reading its journal instead of running it', async () => {
    const store = new GatedStore()
    store.outputGate.resolve()
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
      key: 'A',
      epoch: 1,
      op: OP,
      owner: {},
      sink: { output: () => {}, result: ({ result }) => void results.push(result) },
      fromOffset: 0,
      onReply: () => {},
    })
    await waitFor(() => store.stateEntered)

    const cancelled = ledger.cancel({ key: 'A', epoch: 1 })
    store.stateGate.resolve()
    await running
    await waitFor(() => results.length === 1)

    expect(cancelled).toEqual({ ok: true })
    expect(started).toBe(false)
    const [result] = results
    expect(result?.status).toBe(ECallStatus.Failed)
    if (result?.status === ECallStatus.Failed)
      expect(result.error.code).toBe(ECallFailure.Cancelled)
  })

  it('does not deliver to an owner detached while its replay was being read', async () => {
    const store = new GatedStore()
    const output = new CallOutput({ key: 'A', op: 'exec', store, onFault: () => {} })
    const owner = {}
    const seen: string[] = []
    output.attach({
      owner,
      sink: { output: () => void seen.push('output'), result: () => void seen.push('result') },
      fromOffset: 0,
    })
    await waitFor(() => store.outputEntered)

    output.detach({ owner })
    store.outputGate.resolve()
    output.end({
      result: {
        status: ECallStatus.Ok,
        op: 'exec',
        value: { exitCode: 0, signal: null, outcome: EExecOutcome.Exited, outputBytes: 0 },
      },
    })
    await output.drain()

    expect(seen).toEqual([])
  })
})
