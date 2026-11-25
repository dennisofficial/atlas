import { describe, expect, it } from 'bun:test'
import { TransactionDeadlineError, type TransactionTimeoutReport } from '@dltech/atlas-db'
import {
  ELogSeverity,
  ErrorReporter,
  type LogEntry,
  LogPort,
  NullErrorReporter,
} from '@dltech/atlas-observability'

import { handleTransactionTimeout, TRANSACTION_DEADLINE_SOURCE } from '../transaction-timeout'

class RecordingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

class RecordingErrors extends ErrorReporter {
  readonly reports: { error: Error; properties: Record<string, string | number | boolean> }[] = []

  report(args: { error: Error; properties: Record<string, string | number | boolean> }): void {
    this.reports.push(args)
  }
}

const report: TransactionTimeoutReport = {
  durationMs: 30_010,
  timeoutMs: 30_000,
  statements: 12,
  lastStatement: 'SELECT 1 AS "ok"',
  topStatement: 'SELECT 1 AS "ok"',
  topStatementCount: 11,
}

describe('handleTransactionTimeout', () => {
  it('logs the report and sends the error to PostHog once', () => {
    const log = new RecordingLog()
    const errors = new RecordingErrors()

    handleTransactionTimeout({ report, log, errors })

    expect(log.entries).toEqual([
      {
        severity: ELogSeverity.Error,
        source: TRANSACTION_DEADLINE_SOURCE,
        message: 'transaction open past its 30000ms deadline after 12 statements',
        data: report,
      },
    ])
    expect(errors.reports).toHaveLength(1)
    expect(errors.reports[0]?.error).toBeInstanceOf(TransactionDeadlineError)
    expect(errors.reports[0]?.properties).toEqual({
      source: TRANSACTION_DEADLINE_SOURCE,
      durationMs: 30_010,
      timeoutMs: 30_000,
      statements: 12,
      topStatementCount: 11,
      topStatement: 'SELECT 1 AS "ok"',
      lastStatement: 'SELECT 1 AS "ok"',
    })
  })

  it('omits statement templates a report does not have', () => {
    const errors = new RecordingErrors()

    handleTransactionTimeout({
      report: { durationMs: 30_001, timeoutMs: 30_000, statements: 0, topStatementCount: 0 },
      log: new RecordingLog(),
      errors,
    })

    expect(errors.reports[0]?.properties).toEqual({
      source: TRANSACTION_DEADLINE_SOURCE,
      durationMs: 30_001,
      timeoutMs: 30_000,
      statements: 0,
      topStatementCount: 0,
    })
  })

  it('accepts the null reporter', () => {
    const log = new RecordingLog()

    expect(() =>
      handleTransactionTimeout({ report, log, errors: new NullErrorReporter() }),
    ).not.toThrow()
    expect(log.entries).toHaveLength(1)
  })
})
