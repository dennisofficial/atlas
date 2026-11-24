import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { ATLAS_DIRECTORY_NAME } from '@dltech/atlas-core'
import { ELogSeverity, LogPort, type LogEntry } from '@dltech/atlas-observability'

const LOG_LINE_VERSION = 1

const LOGS_FILE = 'logs.jsonl'

type LogLine = {
  v: number
  at: string
  severity: ELogSeverity
  source: string
  message: string
  threadId?: string | undefined
  error?: string | undefined
  stack?: string | undefined
  data?: Record<string, unknown> | undefined
}

/**
 * Boot-time failures happen before anything else in the process exists, so the writer is built here
 * rather than resolved from a container. Every write failure is swallowed: a log that cannot be
 * written must never be the reason Atlas fails to start.
 */
class HomeOpLog extends LogPort {
  private readonly home: string
  private readonly pending = new Set<Promise<void>>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(home: string) {
    super()
    this.home = home
  }

  record(entry: LogEntry): void {
    const line = `${JSON.stringify(this.lineOf(entry))}\n`
    const write = this.append(line).catch(() => {})
    this.pending.add(write)
    void write.finally(() => this.pending.delete(write))
  }

  async settled(): Promise<void> {
    await Promise.all([...this.pending])
  }

  private lineOf(entry: LogEntry): LogLine {
    return {
      v: LOG_LINE_VERSION,
      at: new Date().toISOString(),
      severity: entry.severity,
      source: entry.source,
      message: entry.message,
      ...(entry.threadId === undefined ? {} : { threadId: entry.threadId }),
      ...(entry.error === undefined ? {} : { error: entry.error }),
      ...(entry.stack === undefined ? {} : { stack: entry.stack }),
      ...(entry.data === undefined ? {} : { data: entry.data }),
    }
  }

  private append(line: string): Promise<void> {
    const next = this.queue.then(async () => {
      const file = join(this.home, LOGS_FILE)
      await mkdir(dirname(file), { recursive: true })
      await appendFile(file, line, 'utf8')
    })
    this.queue = next.catch(() => {})
    return next
  }
}

export type OpLog = LogPort & { settled(): Promise<void> }

export function durableOpLog(): OpLog | null {
  try {
    return new HomeOpLog(process.env.ATLAS_HOME ?? join(homedir(), ATLAS_DIRECTORY_NAME))
  } catch {
    return null
  }
}
