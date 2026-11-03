import type { CallOp } from '@dltech/atlas-protocol'

import { readJournal, removeCall, writeJournal } from '../journal'
import type { OpHandler, OpRegistry } from '../ops/registry'
import { toJournalRecord } from '../ops/registry'
import type { CallRecord, LedgerError, RunOutcome } from './ledger'
import { ELedgerError } from './ledger'

export type RestoreDeps = {
  home: string
  ops: OpRegistry
  epoch(): number
  start(args: { handler: OpHandler; record: CallRecord }): void
  remember(record: CallRecord): void
}

const unknownKey = (key: string): RunOutcome => ({
  ok: false,
  failure: { error: ELedgerError.UnknownKey, message: `unknown key ${key}` },
})

export const restoreCall = async (
  deps: RestoreDeps,
  args: { key: string },
): Promise<RunOutcome> => {
  const journaled = await readJournal({ home: deps.home, key: args.key })
  if (journaled === null) return unknownKey(args.key)

  if (journaled.state !== 'done') {
    await removeCall({ home: deps.home, key: args.key })
    return await respawnCall(deps, args, journaled.op as CallOp)
  }

  const record: CallRecord = {
    key: args.key,
    epoch: journaled.epoch,
    op: journaled.op as CallOp,
    state: 'done',
    ...(journaled.result === undefined ? {} : { result: journaled.result }),
  }
  deps.remember(record)
  return { ok: true, state: 'done', result: record.result }
}

const respawnCall = async (
  deps: RestoreDeps,
  args: { key: string },
  op: CallOp,
): Promise<RunOutcome> => {
  const handler = deps.ops[op.op]
  if (handler === undefined) {
    const failure: LedgerError = {
      error: ELedgerError.UnsupportedOp,
      message: `no handler for ${op.op}`,
    }
    return { ok: false, failure }
  }
  const record: CallRecord = { key: args.key, epoch: deps.epoch(), op, state: 'running' }
  await writeJournal({
    home: deps.home,
    key: args.key,
    record: toJournalRecord({ record, bytes: 0 }),
  })
  deps.remember(record)
  deps.start({ handler, record })
  return { ok: true, state: 'running' }
}
