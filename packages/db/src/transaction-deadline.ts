import pg from 'pg'

const STATEMENT_TEMPLATE_LIMIT = 200
const TRANSACTION_START = /^\s*(?:BEGIN|START\s+TRANSACTION)\b/i
const TRANSACTION_END = /^\s*(?:COMMIT|END|ROLLBACK(?!\s+TO\b)|ABORT)\b/i

export const DEFAULT_TRANSACTION_TIMEOUT_MS = 30_000

export type TransactionTimeoutReport = {
  durationMs: number
  timeoutMs: number
  statements: number
  lastStatement?: string | undefined
  topStatement?: string | undefined
  topStatementCount: number
}

export const transactionDeadlineMessage = (report: TransactionTimeoutReport): string =>
  `transaction open past its ${report.timeoutMs}ms deadline after ${report.statements} statements`

export class TransactionDeadlineError extends Error {
  readonly durationMs: number
  readonly timeoutMs: number
  readonly statements: number
  readonly lastStatement: string | undefined
  readonly topStatement: string | undefined
  readonly topStatementCount: number

  constructor(report: TransactionTimeoutReport) {
    super(transactionDeadlineMessage(report))
    this.name = 'TransactionDeadlineError'
    this.durationMs = report.durationMs
    this.timeoutMs = report.timeoutMs
    this.statements = report.statements
    this.lastStatement = report.lastStatement
    this.topStatement = report.topStatement
    this.topStatementCount = report.topStatementCount
  }
}

export const logTransactionTimeout = (report: TransactionTimeoutReport): void => {
  console.error(
    JSON.stringify({
      severity: 'error',
      source: 'db.transaction-deadline',
      message: transactionDeadlineMessage(report),
      data: report,
    }),
  )
}

export type TransactionDeadlineOptions = {
  timeoutMs: number
  onTimeout: (report: TransactionTimeoutReport) => void
}

type OpenTransaction = {
  startedAt: number
  timer: ReturnType<typeof setTimeout>
  statements: number
  counts: Map<string, number>
  lastStatement: string | undefined
}

const statementTextOf = (arg: unknown): string | undefined => {
  if (typeof arg === 'string') return arg
  if (typeof arg !== 'object' || arg === null || !('text' in arg)) return undefined
  const text: unknown = Reflect.get(arg, 'text')
  return typeof text === 'string' ? text : undefined
}

const templateOf = (text: string): string => {
  const template = text.trim().replace(/\s+/g, ' ')
  return template.length <= STATEMENT_TEMPLATE_LIMIT
    ? template
    : template.slice(0, STATEMENT_TEMPLATE_LIMIT)
}

const topOf = (counts: Map<string, number>): [string | undefined, number] => {
  let top: string | undefined
  let topCount = 0
  for (const [template, count] of counts) {
    if (count > topCount) {
      top = template
      topCount = count
    }
  }
  return [top, topCount]
}

// pg's query_timeout rejects the hung query but keeps the deaf connection; pg-pool then hands
// the same client to the next waiter (acquire is LIFO), so the pool never recovers from a
// half-open link. Ending the client makes pg-pool remove it on release.
// https://github.com/brianc/node-postgres/blob/pg@8.22.0/packages/pg/lib/client.js#L660
class TransactionDeadlineClient extends pg.Client {
  private readonly deadline: TransactionDeadlineOptions
  private openTransaction: OpenTransaction | undefined
  private exceededReport: TransactionTimeoutReport | undefined

  constructor(config: pg.ClientConfig | undefined, deadline: TransactionDeadlineOptions) {
    super(config)
    this.deadline = deadline
    this.once('end', () => this.clearTransaction())
    this.on('error', () => this.clearTransaction())
  }

  override query<T extends pg.Submittable>(queryStream: T): T
  override query<R extends any[] = any[], I = any[]>(
    queryConfig: pg.QueryArrayConfig<I>,
    values?: pg.QueryConfigValues<I>,
  ): Promise<pg.QueryArrayResult<R>>
  override query<R extends pg.QueryResultRow = any, I = any>(
    queryConfig: pg.QueryConfig<I>,
  ): Promise<pg.QueryResult<R>>
  override query<R extends pg.QueryResultRow = any, I = any[]>(
    queryTextOrConfig: string | pg.QueryConfig<I>,
    values?: pg.QueryConfigValues<I>,
  ): Promise<pg.QueryResult<R>>
  override query<R extends any[] = any[], I = any[]>(
    queryConfig: pg.QueryArrayConfig<I>,
    callback: (err: Error, result: pg.QueryArrayResult<R>) => void,
  ): void
  override query<R extends pg.QueryResultRow = any, I = any[]>(
    queryTextOrConfig: string | pg.QueryConfig<I>,
    callback: (err: Error, result: pg.QueryResult<R>) => void,
  ): void
  override query<R extends pg.QueryResultRow = any, I = any[]>(
    queryText: string,
    values: pg.QueryConfigValues<I>,
    callback: (err: Error, result: pg.QueryResult<R>) => void,
  ): void
  override query(...args: unknown[]): unknown {
    const text = statementTextOf(args[0])
    if (text !== undefined) this.noteStatement(text)
    const result: unknown = Reflect.apply(super.query, this, args)
    if (result instanceof Promise) {
      return result.catch((error: unknown) => this.settleAfterDeadline(error))
    }
    return result
  }

  private settleAfterDeadline(error: unknown): never {
    const report = this.exceededReport
    if (report !== undefined) throw new TransactionDeadlineError(report)
    if (error instanceof Error && error.message === 'Query read timeout') {
      void this.end().catch(() => undefined)
    }
    throw error
  }

  private noteStatement(text: string): void {
    if (this.exceededReport !== undefined) return
    if (TRANSACTION_END.test(text)) {
      this.clearTransaction()
      return
    }
    if (TRANSACTION_START.test(text)) {
      this.startTransaction()
      return
    }
    const open = this.openTransaction
    if (open === undefined) return
    const template = templateOf(text)
    if (template.length === 0) return
    open.statements += 1
    open.lastStatement = template
    open.counts.set(template, (open.counts.get(template) ?? 0) + 1)
  }

  private startTransaction(): void {
    this.clearTransaction()
    const startedAt = Date.now()
    this.openTransaction = {
      startedAt,
      timer: setTimeout(() => this.expire(startedAt), this.deadline.timeoutMs),
      statements: 0,
      counts: new Map(),
      lastStatement: undefined,
    }
  }

  private expire(startedAt: number): void {
    const open = this.openTransaction
    if (open === undefined || open.startedAt !== startedAt) return
    this.openTransaction = undefined
    const [topStatement, topStatementCount] = topOf(open.counts)
    const report: TransactionTimeoutReport = {
      durationMs: Date.now() - startedAt,
      timeoutMs: this.deadline.timeoutMs,
      statements: open.statements,
      lastStatement: open.lastStatement,
      topStatement,
      topStatementCount,
    }
    this.exceededReport = report
    try {
      this.deadline.onTimeout(report)
    } catch {
      logTransactionTimeout(report)
    }
    void this.end().catch(() => undefined)
  }

  private clearTransaction(): void {
    const open = this.openTransaction
    if (open === undefined) return
    clearTimeout(open.timer)
    this.openTransaction = undefined
  }
}

export const deadlineClientOf = (
  deadline: TransactionDeadlineOptions,
): (new (
  config?: pg.ClientConfig,
) => pg.Client) =>
  class extends TransactionDeadlineClient {
    constructor(config?: pg.ClientConfig) {
      super(config, deadline)
    }
  }
