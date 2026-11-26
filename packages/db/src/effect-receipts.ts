import type { Db, Tx } from './client'
import type { Row } from './row'

export type EffectReceiptKey = { threadId: string; stepKey: string }

export type EffectReceiptResult = Row<'EffectReceipt'>['result']

export type EffectReceiptClaim = { kind: 'claimed' } | { kind: 'replayed'; result: unknown }

const receiptIn = async (params: EffectReceiptKey & { tx: Tx }) =>
  await params.tx.orm.public.EffectReceipt.first({
    threadId: params.threadId,
    stepKey: params.stepKey,
  })

export const claimEffectReceiptIn = async (
  params: EffectReceiptKey & { tx: Tx },
): Promise<EffectReceiptClaim> => {
  const inserted = await params.tx.orm.public.EffectReceipt.createAndCount(
    [
      {
        threadId: params.threadId,
        stepKey: params.stepKey,
        result: null,
        createdAt: new Date(),
      },
    ],
    { onConflict: 'skip' },
  )
  if (inserted === 1) return { kind: 'claimed' }
  const row = await receiptIn(params)
  if (row === null) {
    throw new Error(`effect receipt ${params.stepKey} was skipped and cannot be read back`)
  }
  return { kind: 'replayed', result: row.result }
}

export const completeEffectReceiptIn = async (
  params: EffectReceiptKey & { tx: Tx; result: EffectReceiptResult },
): Promise<void> => {
  const changed = await params.tx.orm.public.EffectReceipt.where({
    threadId: params.threadId,
    stepKey: params.stepKey,
  }).updateAndCount({ result: params.result })
  if (changed !== 1) throw new Error(`effect receipt ${params.stepKey} is missing`)
}

export const readEffectReceiptIn = async (
  params: EffectReceiptKey & { tx: Tx },
): Promise<EffectReceiptResult | undefined> => {
  const row = await receiptIn(params)
  return row === null || row.result === null ? undefined : row.result
}

export const onceByStep = async <T>(params: {
  db: Db
  threadId: string
  stepKey: string
  decode: (result: unknown) => T
  encode: (value: T) => EffectReceiptResult
  run: (tx: Tx) => Promise<T>
}): Promise<T> =>
  await params.db.transaction(async (tx) => {
    const claim = await claimEffectReceiptIn({
      tx,
      threadId: params.threadId,
      stepKey: params.stepKey,
    })
    if (claim.kind === 'replayed') return params.decode(claim.result)
    const value = await params.run(tx)
    await completeEffectReceiptIn({
      tx,
      threadId: params.threadId,
      stepKey: params.stepKey,
      result: params.encode(value),
    })
    return value
  })
