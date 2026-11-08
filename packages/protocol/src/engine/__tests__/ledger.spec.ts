import { describe, expect, it } from 'bun:test'

import { EDaemonErrorKind } from '../../frames'
import {
  ECallFailure,
  ECallStatus,
  EExecOutcome,
  type CallOp,
  type CallResult,
  type OpName,
} from '../../ops'
import { ECallJournalState, MemoryCallStore, type CallJournal, type CallStore } from '../call-store'
import { defineOp, type RegisteredOp } from '../group'
import { CallLedger, type LedgerOutcome } from '../ledger'

const OP: CallOp = { op: 'exec', argv: ['work'] }

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const gate = (): { opened: Promise<void>; open(): void } => {
  let release = (): void => {}
  const opened = new Promise<void>((resolve) => {
    release = resolve
  })
  return { opened, open: () => release() }
}

const errno = (code: string): Error => Object.assign(new Error(code), { code })

class ControlledStore implements CallStore {
  readonly memory = new MemoryCallStore()
  beforeWrite: (journal: CallJournal) => Promise<void> = async () => {}
  beforeAppend: () => Promise<void> = async () => {}
  beforeRead: () => Promise<void> = async () => {}

  prune(): Promise<void> {
    return this.memory.prune()
  }

  readState(args: { key: string }): Promise<CallJournal | undefined> {
    return this.memory.readState(args)
  }

  async writeState(args: { key: string; journal: CallJournal }): Promise<void> {
    await this.beforeWrite(args.journal)
    await this.memory.writeState(args)
  }

  async appendOutput(args: { key: string; bytes: Uint8Array }): Promise<void> {
    await this.beforeAppend()
    await this.memory.appendOutput(args)
  }

  async readOutput(args: { key: string; offset: number }): Promise<Uint8Array> {
    await this.beforeRead()
    return await this.memory.readOutput(args)
  }

  remove(args: { key: string }): Promise<void> {
    return this.memory.remove(args)
  }
}

const recorder = () => {
  const output: string[] = []
  const results: CallResult[] = []
  return {
    owner: {},
    output,
    results,
    sink: {
      output: ({ bytes }: { bytes: Uint8Array }) => void output.push(Buffer.from(bytes).toString()),
      result: ({ result }: { result: CallResult }) => void results.push(result),
    },
    resultsAt: async (count: number): Promise<CallResult[]> => {
      for (let attempt = 0; attempt < 400 && results.length < count; attempt++) await sleep(5)
      if (results.length < count) throw new Error(`${results.length} of ${count} results`)
      return results
    },
    firstResult: async (): Promise<CallResult> => {
      for (let attempt = 0; attempt < 400 && results.length === 0; attempt++) await sleep(5)
      const [result] = results
      if (result === undefined) throw new Error('no result')
      return result
    },
  }
}

type Recorder = ReturnType<typeof recorder>

const ledgerOn = (
  store: CallStore,
  options?: { hold?: Promise<void> | undefined },
): { ledger: CallLedger; started: string[] } => {
  const started: string[] = []
  const exec = defineOp({
    op: 'exec',
    run: async ({ ctx }) => {
      started.push(ctx.key)
      ctx.output(new TextEncoder().encode('abc'))
      await options?.hold
      return { exitCode: 0, signal: null, outcome: EExecOutcome.Exited, outputBytes: 3 }
    },
  })
  const ledger = new CallLedger({
    store,
    bootId: 'boot',
    ops: new Map<OpName, RegisteredOp>([['exec', exec]]),
    publish: () => {},
    onFault: () => {},
  })
  return { ledger, started }
}

const runOn = (args: {
  ledger: CallLedger
  epoch: number
  rec: Recorder
}): Promise<LedgerOutcome> =>
  args.ledger.run({
    key: 'k',
    epoch: args.epoch,
    op: OP,
    owner: args.rec.owner,
    sink: args.rec.sink,
    fromOffset: 0,
    onReply: () => {},
  })

const failureCode = (result: CallResult): ECallFailure | undefined =>
  result.status === ECallStatus.Failed ? result.error.code : undefined

describe('CallLedger under a slow or failing store', () => {
  it('never starts a run whose epoch was superseded while its journal was written', async () => {
    const store = new ControlledStore()
    const journaled = gate()
    store.beforeWrite = async (journal) => {
      if (journal.state === ECallJournalState.Running) await journaled.opened
    }
    const { ledger, started } = ledgerOn(store)
    ledger.hello({ epoch: 5 })
    const stale = runOn({ ledger, epoch: 5, rec: recorder() })
    await sleep(10)
    expect(ledger.hello({ epoch: 6 }).ok).toBe(true)
    const holder = recorder()
    const fresh = runOn({ ledger, epoch: 6, rec: holder })
    journaled.open()
    expect(await stale).toMatchObject({ ok: false, errorKind: EDaemonErrorKind.StaleEpoch })
    expect(await fresh).toEqual({ ok: true })
    expect((await holder.firstResult()).status).toBe(ECallStatus.Ok)
    expect(started).toEqual(['k'])
    expect(ledger.runCount()).toBe(1)
  })

  it('honours a cancel that arrives while the journal is being written', async () => {
    const store = new ControlledStore()
    const journaled = gate()
    store.beforeWrite = async (journal) => {
      if (journal.state === ECallJournalState.Running) await journaled.opened
    }
    const { ledger, started } = ledgerOn(store)
    ledger.hello({ epoch: 5 })
    const rec = recorder()
    const running = runOn({ ledger, epoch: 5, rec })
    await sleep(10)
    expect(await ledger.cancel({ key: 'k', epoch: 5 })).toEqual({ ok: true })
    journaled.open()
    expect(await running).toEqual({ ok: true })
    expect(failureCode(await rec.firstResult())).toBe(ECallFailure.Cancelled)
    expect(started).toEqual([])
    expect(ledger.runCount()).toBe(0)
  })

  it('carries a new holder cancel to its own run queued behind a superseded one', async () => {
    const store = new ControlledStore()
    const journaled = gate()
    store.beforeWrite = async (journal) => {
      if (journal.state === ECallJournalState.Running) await journaled.opened
    }
    const { ledger, started } = ledgerOn(store)
    ledger.hello({ epoch: 5 })
    const stale = runOn({ ledger, epoch: 5, rec: recorder() })
    await sleep(10)
    ledger.hello({ epoch: 6 })
    const holder = recorder()
    const fresh = runOn({ ledger, epoch: 6, rec: holder })
    expect(ledger.cancel({ key: 'k', epoch: 6 })).toEqual({ ok: true })
    journaled.open()
    expect((await stale).ok).toBe(false)
    expect(await fresh).toEqual({ ok: true })
    expect(failureCode(await holder.firstResult())).toBe(ECallFailure.Cancelled)
    expect(started).toEqual([])
  })

  it('does not carry a cancel onto a run that arrives after it', async () => {
    const store = new ControlledStore()
    const journaled = gate()
    store.beforeWrite = async (journal) => {
      if (journal.state === ECallJournalState.Running && journal.epoch === 5) await journaled.opened
    }
    const { ledger, started } = ledgerOn(store)
    ledger.hello({ epoch: 5 })
    const stale = runOn({ ledger, epoch: 5, rec: recorder() })
    await sleep(10)
    ledger.hello({ epoch: 6 })
    expect(ledger.cancel({ key: 'k', epoch: 6 })).toEqual({ ok: true })
    journaled.open()
    expect((await stale).ok).toBe(false)
    const later = recorder()
    expect(await runOn({ ledger, epoch: 6, rec: later })).toEqual({ ok: true })
    expect((await later.firstResult()).status).toBe(ECallStatus.Ok)
    expect(started).toEqual(['k'])
  })

  it('fails the call with output-lost when an output append fails', async () => {
    const store = new ControlledStore()
    store.beforeAppend = async () => {
      throw errno('ENOSPC')
    }
    const { ledger } = ledgerOn(store)
    ledger.hello({ epoch: 1 })
    const rec = recorder()
    await runOn({ ledger, epoch: 1, rec })
    expect(failureCode(await rec.firstResult())).toBe(ECallFailure.OutputLost)
    const journal = store.memory.journalOf('k')
    expect(journal?.state).toBe(ECallJournalState.Done)
    expect(
      journal?.state === ECallJournalState.Done ? failureCode(journal.result) : undefined,
    ).toBe(ECallFailure.OutputLost)
  })

  it('still answers a replay whose read fails, with output-lost', async () => {
    const store = new ControlledStore()
    const { ledger } = ledgerOn(store)
    ledger.hello({ epoch: 1 })
    const first = recorder()
    await runOn({ ledger, epoch: 1, rec: first })
    await first.firstResult()
    store.beforeRead = async () => {
      throw errno('EIO')
    }
    const replay = recorder()
    expect(await runOn({ ledger, epoch: 1, rec: replay })).toEqual({ ok: true })
    expect(failureCode(await replay.firstResult())).toBe(ECallFailure.OutputLost)
  })

  it('answers a replay attached to a running call whose read fails, with output-lost', async () => {
    const store = new ControlledStore()
    const hold = gate()
    const { ledger } = ledgerOn(store, { hold: hold.opened })
    ledger.hello({ epoch: 1 })
    await runOn({ ledger, epoch: 1, rec: recorder() })
    store.beforeRead = async () => {
      throw errno('EIO')
    }
    const replay = recorder()
    await runOn({ ledger, epoch: 1, rec: replay })
    await sleep(10)
    hold.open()
    expect(failureCode(await replay.firstResult())).toBe(ECallFailure.OutputLost)
  })

  it('owes one output-lost result per failed replay from the same owner', async () => {
    const store = new ControlledStore()
    const hold = gate()
    const { ledger } = ledgerOn(store, { hold: hold.opened })
    ledger.hello({ epoch: 1 })
    await runOn({ ledger, epoch: 1, rec: recorder() })
    store.beforeRead = async () => {
      throw errno('EIO')
    }
    const replay = recorder()
    await runOn({ ledger, epoch: 1, rec: replay })
    await runOn({ ledger, epoch: 1, rec: replay })
    await sleep(10)
    hold.open()
    const results = await replay.resultsAt(2)
    expect(results.map(failureCode)).toEqual([ECallFailure.OutputLost, ECallFailure.OutputLost])
  })

  it('lets an accepted replay read its output before an ack removes it', async () => {
    const store = new ControlledStore()
    const { ledger } = ledgerOn(store)
    ledger.hello({ epoch: 1 })
    const first = recorder()
    await runOn({ ledger, epoch: 1, rec: first })
    await first.firstResult()
    const read = gate()
    store.beforeRead = async () => await read.opened
    const replay = recorder()
    await runOn({ ledger, epoch: 1, rec: replay })
    const acked = ledger.ack({ key: 'k', epoch: 1 })
    await sleep(10)
    read.open()
    expect(await acked).toEqual({ ok: true })
    expect(replay.output.join('')).toBe('abc')
    expect((await replay.firstResult()).status).toBe(ECallStatus.Ok)
  })

  it('never publishes success when the done journal cannot be persisted', async () => {
    const store = new ControlledStore()
    store.beforeWrite = async (journal) => {
      if (journal.state === ECallJournalState.Done) throw errno('EIO')
    }
    const { ledger } = ledgerOn(store)
    ledger.hello({ epoch: 1 })
    const rec = recorder()
    await runOn({ ledger, epoch: 1, rec })
    expect(failureCode(await rec.firstResult())).toBe(ECallFailure.PersistFailed)
    expect(rec.results.every((result) => result.status === ECallStatus.Failed)).toBe(true)
  })
})
