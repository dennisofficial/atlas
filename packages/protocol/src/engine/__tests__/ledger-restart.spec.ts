import { describe, expect, it } from 'bun:test'

import { EDaemonAnswer } from '@dltech/atlas-core'

import {
  ECallFailure,
  ECallStatus,
  EExecOutcome,
  type CallOp,
  type CallResult,
  type OpName,
} from '../../ops'
import { EDaemonErrorKind } from '../../frames'
import {
  CALL_JOURNAL_FORMAT,
  ECallJournalState,
  MemoryCallStore,
  parseCallJournal,
  type CallJournal,
  type CallStore,
} from '../call-store'
import { defineOp, type RegisteredOp } from '../group'
import { CallLedger, type LedgerOutcome } from '../ledger'

const OP: CallOp = { op: 'exec', argv: ['work'] }

const DONE_RESULT: CallResult = {
  status: ECallStatus.Ok,
  op: 'exec',
  value: { exitCode: 0, signal: null, outcome: EExecOutcome.Exited, outputBytes: 3 },
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

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
  options?: { ops?: boolean | undefined; bootId?: string | undefined },
): { ledger: CallLedger; started: string[] } => {
  const started: string[] = []
  const exec = defineOp({
    op: 'exec',
    run: async ({ ctx }) => {
      started.push(ctx.key)
      ctx.output(new TextEncoder().encode('new'))
      return { exitCode: 0, signal: null, outcome: EExecOutcome.Exited, outputBytes: 3 }
    },
  })
  const ledger = new CallLedger({
    store,
    bootId: options?.bootId ?? 'boot',
    ops: new Map<OpName, RegisteredOp>(options?.ops === false ? [] : [['exec', exec]]),
    publish: () => {},
    onFault: () => {},
  })
  return { ledger, started }
}

const runOn = async (args: {
  ledger: CallLedger
  epoch: number
  rec: Recorder
}): Promise<LedgerOutcome> => {
  const outcome = await args.ledger.run({
    key: 'k',
    epoch: args.epoch,
    op: OP,
    owner: args.rec.owner,
    sink: args.rec.sink,
    fromOffset: 0,
    onReply: () => {},
  })
  return outcome
}

const failureCode = (result: CallResult): ECallFailure | undefined =>
  result.status === ECallStatus.Failed ? result.error.code : undefined

const doneJournal = (args: { outputBytes?: number | undefined }): CallJournal => ({
  format: CALL_JOURNAL_FORMAT,
  state: ECallJournalState.Done,
  epoch: 1,
  op: OP,
  outputBytes: args.outputBytes ?? 3,
  result: DONE_RESULT,
})

const runningJournal = (): CallJournal => ({
  format: CALL_JOURNAL_FORMAT,
  state: ECallJournalState.Running,
  epoch: 1,
  op: OP,
  outputBytes: 0,
})

describe('CallLedger across a daemon boot', () => {
  it('serves a done journal written by a previous daemon without running the op', async () => {
    const store = new MemoryCallStore()
    await store.writeState({ key: 'k', journal: doneJournal({}) })
    await store.appendOutput({ key: 'k', bytes: new TextEncoder().encode('abc') })

    const { ledger, started } = ledgerOn(store, { ops: false, bootId: 'second' })
    await ledger.open()
    expect(await ledger.answer({ key: 'k' })).toBe(EDaemonAnswer.Done)
    expect(await ledger.answer({ key: 'nothing' })).toBe(EDaemonAnswer.NeverSeen)

    const rec = recorder()
    expect(await runOn({ ledger, epoch: 1, rec })).toEqual({ ok: true })
    expect((await rec.firstResult()).status).toBe(ECallStatus.Ok)
    expect(rec.output.join('')).toBe('abc')
    expect(started).toEqual([])
    expect(ledger.runCount()).toBe(0)
  })

  it('removes the adopted journal on ack, so a later run executes the op again', async () => {
    const store = new MemoryCallStore()
    await store.writeState({ key: 'k', journal: doneJournal({}) })
    const { ledger, started } = ledgerOn(store, { bootId: 'second' })
    await ledger.open()
    const rec = recorder()
    await runOn({ ledger, epoch: 1, rec })
    await rec.firstResult()
    expect(await ledger.ack({ key: 'k', epoch: 1 })).toEqual({ ok: true })
    expect(await store.readState({ key: 'k' })).toBeUndefined()

    const rec2 = recorder()
    await runOn({ ledger, epoch: 1, rec: rec2 })
    expect((await rec2.firstResult()).status).toBe(ECallStatus.Ok)
    expect(started).toEqual(['k'])
  })

  it('answers interrupted for a journal that was still running and rewrites it done', async () => {
    const store = new MemoryCallStore()
    await store.writeState({ key: 'k', journal: runningJournal() })
    const { ledger, started } = ledgerOn(store, { bootId: 'second' })
    await ledger.open()
    expect(await ledger.answer({ key: 'k' })).toBe(EDaemonAnswer.Running)

    const rec = recorder()
    await runOn({ ledger, epoch: 1, rec })
    const result = await rec.firstResult()
    expect(failureCode(result)).toBe(ECallFailure.Interrupted)
    expect(result.status === ECallStatus.Failed ? result.error.message : '').toContain(
      'interrupted by a daemon restart',
    )
    expect(started).toEqual([])

    const stored = await store.readState({ key: 'k' })
    expect(stored?.state).toBe(ECallJournalState.Done)
    expect(stored?.state === ECallJournalState.Done ? failureCode(stored.result) : undefined).toBe(
      ECallFailure.Interrupted,
    )
    expect(await ledger.answer({ key: 'k' })).toBe(EDaemonAnswer.Done)
  })

  it('keeps a journal across a memory store boot, so a restart is not a wipe', async () => {
    const store = new MemoryCallStore()
    const first = ledgerOn(store, { bootId: 'first' })
    await first.ledger.open()
    const rec = recorder()
    await runOn({ ledger: first.ledger, epoch: 1, rec })
    await rec.firstResult()

    const second = ledgerOn(store, { bootId: 'second' })
    await second.ledger.open()
    expect(await second.ledger.answer({ key: 'k' })).toBe(EDaemonAnswer.Done)
  })

  it('refuses a run it cannot journal when the store fails to read, instead of running it', async () => {
    const store = new MemoryCallStore()
    const broken: CallStore = {
      prune: () => store.prune(),
      readState: async () => {
        throw new Error('EIO')
      },
      writeState: (args) => store.writeState(args),
      appendOutput: (args) => store.appendOutput(args),
      readOutput: (args) => store.readOutput(args),
      remove: (args) => store.remove(args),
    }
    let faulted = 0
    const started: string[] = []
    const ledger = new CallLedger({
      store: broken,
      bootId: 'second',
      ops: new Map<OpName, RegisteredOp>([
        [
          'exec',
          defineOp({
            op: 'exec',
            run: async () => {
              started.push('k')
              return { exitCode: 0, signal: null, outcome: EExecOutcome.Exited, outputBytes: 0 }
            },
          }),
        ],
      ]),
      publish: () => {},
      onFault: () => {
        faulted += 1
      },
    })
    expect(await runOn({ ledger, epoch: 1, rec: recorder() })).toMatchObject({
      ok: false,
      errorKind: EDaemonErrorKind.Internal,
    })
    expect(started).toEqual([])
    expect(faulted).toBe(1)
    expect(ledger.runCount()).toBe(0)
  })
})

describe('parseCallJournal', () => {
  it('accepts the current format and rejects anything it cannot read', () => {
    expect(parseCallJournal(doneJournal({}))).toEqual(doneJournal({}))
    expect(parseCallJournal(runningJournal())).toEqual(runningJournal())
    expect(parseCallJournal({ ...doneJournal({}), format: 2 })).toBeUndefined()
    expect(parseCallJournal({ state: 'done', epoch: 1, op: OP, outputBytes: 3 })).toBeUndefined()
    expect(
      parseCallJournal({
        format: CALL_JOURNAL_FORMAT,
        state: 'done',
        epoch: 1,
        op: OP,
        outputBytes: 3,
      }),
    ).toBeUndefined()
    expect(parseCallJournal('not a journal')).toBeUndefined()
  })
})
