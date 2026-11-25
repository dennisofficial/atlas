import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createDb, type Db } from '../client'
import { retryOnConnectionLoss } from '../connection-retry'
import {
  createPool,
  TransactionDeadlineError,
  transactionDeadlineMessage,
  type Pool,
  type TransactionTimeoutReport,
} from '../pool'
import { useTestDatabase } from '../testing'

const testDatabase = useTestDatabase()

const DEADLINE_MS = 300

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const deadlineIn = (error: unknown): TransactionDeadlineError | undefined => {
  let link: unknown = error
  for (let depth = 0; depth < 8 && link instanceof Error; depth += 1) {
    if (link instanceof TransactionDeadlineError) return link
    link = link.cause
  }
  return undefined
}

async function selectOne(tx: Parameters<Parameters<Db['transaction']>[0]>[0]): Promise<void> {
  await tx.query(tx.raw.sql`SELECT 1 AS "ok"`.returnsRow({ ok: 'pg/int4@1' }).build())
}

async function loopSelects(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    for (let index = 0; index < 100_000; index += 1) await selectOne(tx)
  })
}

describe('the whole-transaction deadline', () => {
  let pool: Pool
  let db: Db
  let reports: TransactionTimeoutReport[]

  beforeAll(() => {
    const { url } = testDatabase()
    pool = createPool(url, {
      transactionTimeoutMs: DEADLINE_MS,
      onTransactionTimeout: (report) => reports.push(report),
    })
    db = createDb(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(() => {
    reports = []
  })

  it('kills a transaction that outlives the deadline and reports it once', async () => {
    const started = Date.now()
    const error = await loopSelects(db).then(
      () => undefined,
      (failure: unknown) => failure,
    )

    expect(Date.now() - started).toBeLessThan(5_000)
    const deadline = deadlineIn(error)
    expect(deadline).toBeInstanceOf(TransactionDeadlineError)
    expect(deadline?.name).toBe('TransactionDeadlineError')
    expect(deadline?.cause).toBeUndefined()
    expect(deadline?.message).toBe(transactionDeadlineMessage(deadline!))
    expect(deadline?.statements).toBeGreaterThan(1)
    expect(deadline?.durationMs).toBeGreaterThanOrEqual(DEADLINE_MS - 1)
    expect(reports).toHaveLength(1)
    expect(reports[0]?.statements).toBe(deadline?.statements)
    expect(reports[0]?.timeoutMs).toBe(DEADLINE_MS)
    expect(reports[0]?.lastStatement).toBe('SELECT 1 AS "ok"')
    expect(reports[0]?.topStatement).toBe('SELECT 1 AS "ok"')
    expect(reports[0]?.topStatementCount).toBeGreaterThan(1)
  })

  it('drops the dead client and serves the next transaction', async () => {
    await loopSelects(db).catch(() => undefined)
    await sleep(50)
    expect(pool.totalCount).toBe(0)

    await expect(db.transaction(selectOne)).resolves.toBeUndefined()
    expect(pool.totalCount).toBe(1)
    expect(pool.idleCount).toBe(1)
    expect(reports).toHaveLength(1)
  })

  it('leaves a transaction that finishes under the deadline alone', async () => {
    await expect(db.transaction(selectOne)).resolves.toBeUndefined()
    await sleep(DEADLINE_MS + 100)
    expect(reports).toHaveLength(0)
    await expect(db.transaction(selectOne)).resolves.toBeUndefined()
  })

  it('does not let retryOnConnectionLoss replay a transaction killed by the deadline', async () => {
    let entered = 0
    const error = await retryOnConnectionLoss(async () => {
      entered += 1
      await loopSelects(db)
    }).then(
      () => undefined,
      (failure: unknown) => failure,
    )

    expect(entered).toBe(1)
    expect(deadlineIn(error)).toBeInstanceOf(TransactionDeadlineError)
    expect(reports).toHaveLength(1)
  })
})

describe('TransactionDeadlineError', () => {
  it('carries the report and no cause', () => {
    const error = new TransactionDeadlineError({
      durationMs: 30_010,
      timeoutMs: 30_000,
      statements: 12,
      lastStatement: 'SELECT 1',
      topStatement: 'SELECT 1',
      topStatementCount: 11,
    })

    expect(error.name).toBe('TransactionDeadlineError')
    expect(error.message).toBe('transaction open past its 30000ms deadline after 12 statements')
    expect(error.cause).toBeUndefined()
    expect(error.durationMs).toBe(30_010)
    expect(error.statements).toBe(12)
    expect(error.topStatementCount).toBe(11)
  })
})
