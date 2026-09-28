import type { ThreadId } from '../events/ids'

export enum ELogSeverity {
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
}

export type LogEntry = {
  readonly severity: ELogSeverity
  /** Dot-scoped origin, e.g. `loop.run-turn` or `cloud.lift`. */
  readonly source: string
  readonly message: string
  readonly threadId?: ThreadId | undefined
  /** Caught error's message; the cause chain is folded in, `cause: …`-separated. */
  readonly error?: string | undefined
  readonly stack?: string | undefined
  /** Small structured context (sandbox id, tool name, exit code). Never secrets. */
  readonly data?: Record<string, unknown> | undefined
}

/**
 * Durable operational record: warnings, caught errors, and transitions the domain events do not
 * cover. Fire-and-forget — a logging failure must never break the operation being logged, so
 * `record` returns void and implementations swallow their own IO errors.
 */
export abstract class LogPort {
  abstract record(entry: LogEntry): void

  info(args: { source: string; message: string } & Partial<LogEntry>): void {
    this.record({ severity: ELogSeverity.Info, ...args })
  }

  warn(args: { source: string; message: string } & Partial<LogEntry>): void {
    this.record({ severity: ELogSeverity.Warn, ...args })
  }

  error(args: { source: string; message: string } & Partial<LogEntry>): void {
    this.record({ severity: ELogSeverity.Error, ...args })
  }
}
