import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { ELogSeverity, LogPort, type LogEntry } from '@dltech/atlas-core'

import { logServeFatal, serveFatalEntry, serveOpLog } from '../fatal-log'
import { EServeEnv, ServeNeedsConfiguration } from '../serve-config'

class CapturingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

describe('serveFatalEntry', () => {
  it('keeps the stack the stdout serve.fatal line drops', () => {
    const error = new Error('the workspace would not materialize')
    const entry = serveFatalEntry({ error, env: {} })

    expect(entry.source).toBe('serve.boot')
    expect(entry.severity ?? ELogSeverity.Error).toBe(ELogSeverity.Error)
    expect(entry.error).toBe('the workspace would not materialize')
    expect(entry.stack).toBe(error.stack)
    expect(entry.data?.cwd).toBe(process.cwd())
  })

  it('folds a thrown non-error into the error field', () => {
    const entry = serveFatalEntry({ error: 'socket died', env: {} })

    expect(entry.error).toBe('socket died')
    expect(entry.stack).toBeUndefined()
  })

  it('carries the thread the sandbox named when it knows one', () => {
    const entry = serveFatalEntry({
      error: new Error('boom'),
      env: { [EServeEnv.ThreadId]: 'thread-42' },
    })

    expect(entry.data?.threadId).toBe('thread-42')
    expect(entry.threadId).toBeUndefined()
  })

  it('folds a missing configuration into the message the way ServeNeedsConfiguration names it', () => {
    const error = new ServeNeedsConfiguration({
      variable: EServeEnv.Token,
      detail: 'has no session token to authenticate clients against',
    })
    const entry = serveFatalEntry({ error, env: {} })

    expect(entry.error).toContain('ATLAS_SERVE_TOKEN')
    expect(entry.data?.threadId).toBeNull()
  })
})

describe('logServeFatal', () => {
  it('records through the port it is handed', () => {
    const log = new CapturingLog()
    logServeFatal({ log, error: new Error('boot died'), env: {} })

    expect(log.entries).toHaveLength(1)
    expect(log.entries[0]?.source).toBe('serve.boot')
    expect(log.entries[0]?.severity).toBe(ELogSeverity.Error)
  })

  it('does nothing when no writer could be built', () => {
    expect(() => logServeFatal({ log: null, error: new Error('boot died'), env: {} })).not.toThrow()
  })
})

describe('serveOpLog', () => {
  it('writes the fatal line to the home-level logs.jsonl', async () => {
    const log = serveOpLog()
    expect(log).not.toBeNull()

    logServeFatal({ log, error: new Error('compose failed'), env: {} })
    await log?.settled()

    const file = join(process.env.ATLAS_HOME ?? '', 'logs.jsonl')
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    const parsed = JSON.parse(lines.at(-1) ?? '') as Record<string, unknown>

    expect(parsed.source).toBe('serve.boot')
    expect(parsed.severity).toBe('error')
    expect(parsed.error).toBe('compose failed')
    expect(typeof parsed.stack).toBe('string')
    expect(parsed.threadId).toBeUndefined()
  })
})
