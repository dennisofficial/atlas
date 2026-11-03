import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { type ClockPort, type ThreadId } from '@dltech/atlas-core'

import { sessionDirectory, sessionLogsFile } from './sessions/paths'
import { ATLAS_LOGS_FILE_NAME } from './paths'
import { join } from 'node:path'
import type { SessionRegistry } from './sessions/registry'
import { ELogSeverity, LogPort, type LogEntry } from '@dltech/atlas-observability'

const LOG_LINE_VERSION = 1

type LogLine = {
  v: number
  at: string
  severity: ELogSeverity
  source: string
  message: string
  threadId?: ThreadId
  error?: string
  stack?: string
  data?: Record<string, unknown>
}

/**
 * Always-on operational log: warn/error/transition lines next to the session's events, and in a
 * single home-level file for anything that happens before a session exists (boot). Never read
 * back to build state, and never allowed to break what it logs — every write failure is swallowed.
 */
export class JsonlLog extends LogPort {
  private readonly home: string
  private readonly registry: SessionRegistry
  private readonly clock: ClockPort
  private readonly pending = new Set<Promise<void>>()
  private globalQueue: Promise<unknown> = Promise.resolve()

  constructor(args: { home: string; registry: SessionRegistry; clock: ClockPort }) {
    super()
    this.home = args.home
    this.registry = args.registry
    this.clock = args.clock
  }

  record(entry: LogEntry): void {
    const line = `${JSON.stringify(this.lineOf({ entry }))}\n`
    const write =
      entry.threadId === undefined
        ? this.appendGlobal({ line })
        : this.appendSession({ line, entry })
    const tracked = write.catch(() => {})
    this.pending.add(tracked)
    void tracked.finally(() => this.pending.delete(tracked))
  }

  /** Resolves once every line recorded so far has been written or dropped. */
  async settled(): Promise<void> {
    await Promise.all([...this.pending])
  }

  private lineOf({ entry }: { entry: LogEntry }): LogLine {
    const line: LogLine = {
      v: LOG_LINE_VERSION,
      at: this.clock.now(),
      severity: entry.severity,
      source: entry.source,
      message: entry.message,
    }
    if (entry.threadId !== undefined) line.threadId = entry.threadId
    if (entry.error !== undefined) line.error = entry.error
    if (entry.stack !== undefined) line.stack = entry.stack
    if (entry.data !== undefined) line.data = entry.data
    return line
  }

  private async appendSession({ line, entry }: { line: string; entry: LogEntry }): Promise<void> {
    const threadId = entry.threadId as ThreadId
    const resolved = await this.registry.sessionDirOf({ threadId })
    if (resolved === undefined) {
      await this.appendGlobal({ line })
      return
    }
    const sessionDir = resolved ?? sessionDirectory({ home: this.home, sessionId: threadId })
    const handle = this.registry.handleFor({ sessionDir })
    await this.registry.enqueue({
      handle,
      run: async () => {
        const file = sessionLogsFile({ sessionDir })
        await mkdir(dirname(file), { recursive: true })
        await appendFile(file, line, 'utf8')
      },
    })
  }

  private appendGlobal({ line }: { line: string }): Promise<void> {
    const next = this.globalQueue.then(async () => {
      const file = join(this.home, ATLAS_LOGS_FILE_NAME)
      await mkdir(dirname(file), { recursive: true })
      await appendFile(file, line, 'utf8')
    })
    this.globalQueue = next.catch(() => {})
    return next
  }
}

export { logFieldsOf } from '@dltech/atlas-observability'
