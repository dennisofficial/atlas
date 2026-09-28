import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ELogSeverity, toThreadId, type ThreadId } from '@dltech/atlas-core'

import { newThreadMeta, writeMeta } from '../sessions/meta'
import { sessionDirectory, sessionLogsFile, threadMetaFile } from '../sessions/paths'
import { SessionRegistry } from '../sessions/registry'
import { JsonlLog, logFieldsOf } from '../logs'
import { SteppingClock } from './harness'

const AT = '2026-09-23T10:00:00.000Z'

const homes: string[] = []

function open(): { home: string; logs: JsonlLog; rootId: ThreadId } {
  const home = mkdtempSync(join(tmpdir(), 'atlas-jsonl-logs-'))
  homes.push(home)
  const registry = new SessionRegistry(home)
  const logs = new JsonlLog({ home, registry, clock: new SteppingClock() })
  return { home, logs, rootId: toThreadId('thread-root') }
}

async function plantThread({ home, threadId }: { home: string; threadId: ThreadId }): Promise<void> {
  const meta = newThreadMeta({ id: threadId, at: AT })
  await writeMeta({
    file: threadMetaFile({ sessionDir: sessionDirectory({ home, sessionId: threadId }), threadId }),
    meta: { ...meta, createdAt: AT, spawnerThreadId: null },
  })
}

function linesOf({ file }: { file: string }): Record<string, unknown>[] {
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

async function flush(logs: JsonlLog): Promise<void> {
  await logs.settled()
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('JsonlLog', () => {
  it('writes a known thread’s line into that session’s logs.jsonl', async () => {
    const { home, logs, rootId } = open()
    await plantThread({ home, threadId: rootId })

    logs.warn({
      source: 'loop.run-turn',
      message: 'retrying after provider throttle',
      threadId: rootId,
      data: { attempt: 2 },
    })
    await flush(logs)

    const rows = linesOf({ file: sessionLogsFile({ sessionDir: sessionDirectory({ home, sessionId: rootId }) }) })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      v: 1,
      severity: 'warn',
      source: 'loop.run-turn',
      message: 'retrying after provider throttle',
      threadId: rootId,
      data: { attempt: 2 },
    })
    expect(rows[0]?.at).toBeString()
  })

  it('routes a threadless line to the home-level logs.jsonl', async () => {
    const { home, logs } = open()

    logs.error({ source: 'tui.boot', message: 'composition root failed', error: 'boom' })
    await flush(logs)

    const rows = linesOf({ file: join(home, 'logs.jsonl') })
    expect(rows[0]).toMatchObject({ severity: 'error', source: 'tui.boot', message: 'composition root failed', error: 'boom' })
    expect(rows[0]?.threadId).toBeUndefined()
  })

  it('routes an unknown thread’s line to the home file rather than inventing a session', async () => {
    const { home, logs } = open()

    logs.info({ source: 'spec', message: 'orphan', threadId: toThreadId('thread-gone') })
    await flush(logs)

    const rows = linesOf({ file: join(home, 'logs.jsonl') })
    expect(rows[0]).toMatchObject({ message: 'orphan', threadId: 'thread-gone' })
  })

  it('survives an unwritable home: record never throws and never rejects', async () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-jsonl-logs-'))
    homes.push(home)
    rmSync(home, { recursive: true, force: true })
    const logs = new JsonlLog({ home, registry: new SessionRegistry(home), clock: new SteppingClock() })

    expect(() => logs.error({ source: 'spec', message: 'lost', threadId: toThreadId('x') })).not.toThrow()
    await flush(logs)
  })

  it('info/warn/error helpers stamp the severity', async () => {
    const { home, logs } = open()
    logs.info({ source: 'spec', message: 'a' })
    logs.warn({ source: 'spec', message: 'b' })
    logs.error({ source: 'spec', message: 'c' })
    await flush(logs)

    const rows = linesOf({ file: join(home, 'logs.jsonl') })
    expect(rows.map((row) => row.severity)).toEqual(['info', 'warn', 'error'])
  })
})

describe('logFieldsOf', () => {
  it('extracts message and stack from an Error', () => {
    const fields = logFieldsOf({ error: new Error('disk full') })
    expect(fields.error).toBe('disk full')
    expect(fields.stack).toContain('disk full')
  })

  it('folds an Error cause into the message', () => {
    const fields = logFieldsOf({ error: new Error('lift failed', { cause: new Error('sandbox 504') }) })
    expect(fields.error).toBe('lift failed — cause: sandbox 504')
  })

  it('stringifies non-Error throws', () => {
    expect(logFieldsOf({ error: 'plain string' })).toEqual({ error: 'plain string' })
    expect(logFieldsOf({ error: { weird: true } })).toEqual({ error: '[object Object]' })
  })
})
