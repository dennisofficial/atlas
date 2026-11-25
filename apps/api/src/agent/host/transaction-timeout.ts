import { TransactionDeadlineError, type TransactionTimeoutReport } from '@dltech/atlas-db'
import type { ErrorReporter, LogPort } from '@dltech/atlas-observability'

export const TRANSACTION_DEADLINE_SOURCE = 'db.transaction-deadline'

export const handleTransactionTimeout = (args: {
  report: TransactionTimeoutReport
  log: LogPort
  errors: ErrorReporter
}): void => {
  const error = new TransactionDeadlineError(args.report)
  args.log.error({
    source: TRANSACTION_DEADLINE_SOURCE,
    message: error.message,
    data: { ...args.report },
  })
  args.errors.report({
    error,
    properties: {
      source: TRANSACTION_DEADLINE_SOURCE,
      durationMs: args.report.durationMs,
      timeoutMs: args.report.timeoutMs,
      statements: args.report.statements,
      topStatementCount: args.report.topStatementCount,
      ...(args.report.topStatement === undefined ? {} : { topStatement: args.report.topStatement }),
      ...(args.report.lastStatement === undefined
        ? {}
        : { lastStatement: args.report.lastStatement }),
    },
  })
}
