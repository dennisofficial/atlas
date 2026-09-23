import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

import { toThreadId } from '@dltech/atlas-core'

import { parseEventLines } from '../../store/sessions/lines'
import { sessionMetaSchema, threadMetaSchema } from '../../store/sessions/meta'
import {
  eventLogFile,
  ledgerFile,
  sessionDirectory,
  sessionMetaFile,
  threadMetaFile,
} from '../../store/sessions/paths'
import { exportHarnessDb, type LedgerLine } from '../export-harness-db'
import { AT, insertEvent, insertThread, openFixture, seedFamily } from './fixture'

describe('exportHarnessDb', () => {
  it('writes one session directory per root with events, metas, and a ledger', async () => {
    const fixture = await openFixture()
    await seedFamily(fixture)

    const summary = await exportHarnessDb({
      databaseUrl: fixture.database.databaseUrl,
      home: fixture.home,
    })

    expect(summary).toEqual({
      sessions: 2,
      threads: 4,
      events: 5,
      turns: 2,
      malformedBodies: 0,
      orphanedAgents: 0,
    })

    const rootDir = sessionDirectory({ home: fixture.home, sessionId: 'root' })
    const forkDir = sessionDirectory({ home: fixture.home, sessionId: 'fork' })

    const rootEvents = parseEventLines({
      text: readFileSync(eventLogFile({ sessionDir: rootDir, threadId: toThreadId('root') }), 'utf8'),
      threadId: 'root',
    })
    expect(rootEvents.unreadable).toEqual([])
    expect(rootEvents.events.map((event) => event.seq)).toEqual([1, 2])
    expect(rootEvents.head).toBe(2)
    expect(rootEvents.events[0]?.type).toBe('user-said')

    const agentEvents = parseEventLines({
      text: readFileSync(eventLogFile({ sessionDir: rootDir, threadId: toThreadId('agent') }), 'utf8'),
      threadId: 'agent',
    })
    expect(String(agentEvents.events[0]?.parentRunId)).toBe('run-root')

    const agentMeta = threadMetaSchema.parse(
      JSON.parse(
        readFileSync(threadMetaFile({ sessionDir: rootDir, threadId: toThreadId('agent') }), 'utf8'),
      ),
    )
    expect(agentMeta.spawnerThreadId).toBe('root')
    expect(agentMeta.agentType).toBe('explore')
    expect(agentMeta.parentThreadId).toBeNull()

    const sessionMeta = sessionMetaSchema.parse(
      JSON.parse(readFileSync(sessionMetaFile({ sessionDir: rootDir }), 'utf8')),
    )
    expect(sessionMeta).toEqual({
      format: 1,
      id: 'root',
      title: 'main conversation',
      createdAt: AT,
      updatedAt: AT,
      home: 'local',
      repo: 'dennisofficial/atlas',
      workspace: '/repo',
      worktree: null,
      pullRequests: null,
      spend: null,
    })

    const ledgerLines = readFileSync(ledgerFile({ sessionDir: rootDir }), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as LedgerLine)
    expect(ledgerLines).toEqual([
      {
        runId: 'run-root',
        threadId: 'root',
        status: 'completed',
        providerId: 'anthropic',
        modelId: 'claude-opus-5',
        steps: 2,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 80,
        cacheWriteTokens: 20,
        startedAt: AT,
        endedAt: AT,
        durationMs: 500,
      },
      {
        runId: 'run-agent',
        threadId: 'agent',
        status: 'completed',
        providerId: 'anthropic',
        modelId: 'claude-opus-5',
        steps: 2,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 80,
        cacheWriteTokens: 20,
        startedAt: '2026-09-20T11:00:00.000Z',
        endedAt: AT,
        durationMs: 500,
      },
    ])

    const forkMeta = sessionMetaSchema.parse(
      JSON.parse(readFileSync(sessionMetaFile({ sessionDir: forkDir }), 'utf8')),
    )
    expect(forkMeta.id).toBe('fork')
    expect(forkMeta.title).toBe('fork of main')

    const forkThreadMeta = threadMetaSchema.parse(
      JSON.parse(
        readFileSync(threadMetaFile({ sessionDir: forkDir, threadId: toThreadId('fork') }), 'utf8'),
      ),
    )
    expect(forkThreadMeta.parentThreadId).toBe('root')
    expect(forkThreadMeta.forkSeq).toBe(2)
    expect(forkThreadMeta.forkMode).toBe('full')
  })

  it('writes a malformed stored body as-is and counts it instead of aborting', async () => {
    const fixture = await openFixture()
    await insertThread(fixture, { id: 'root' })
    await insertEvent(fixture, { id: 'e1', threadId: 'root', seq: 1 })
    await insertEvent(fixture, { id: 'e2', threadId: 'root', seq: 2, body: '{not json' })

    const summary = await exportHarnessDb({
      databaseUrl: fixture.database.databaseUrl,
      home: fixture.home,
    })

    expect(summary.malformedBodies).toBe(1)
    expect(summary.events).toBe(2)

    const sessionDir = sessionDirectory({ home: fixture.home, sessionId: 'root' })
    const raw = readFileSync(eventLogFile({ sessionDir, threadId: toThreadId('root') }), 'utf8')
    const preserved = raw.split('\n').find((line) => line.includes('e2'))
    expect(JSON.parse(preserved ?? '')).toMatchObject({ id: 'e2', body: '{not json' })

    const parsed = parseEventLines({ text: raw, threadId: 'root' })
    expect(parsed.events.map((event) => String(event.id))).toEqual(['e1'])
    expect(parsed.unreadable).toHaveLength(1)
  })

  it('exports an orphaned agent as its own session and reports it', async () => {
    const fixture = await openFixture()
    await fixture.database.prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF')
    await insertThread(fixture, { id: 'stray', spawnerThreadId: 'gone', agentType: 'explore' })
    await fixture.database.prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON')
    await insertEvent(fixture, { id: 'e1', threadId: 'stray', seq: 1 })

    const summary = await exportHarnessDb({
      databaseUrl: fixture.database.databaseUrl,
      home: fixture.home,
    })

    expect(summary.orphanedAgents).toBe(1)
    expect(summary.sessions).toBe(1)

    const sessionDir = sessionDirectory({ home: fixture.home, sessionId: 'stray' })
    const meta = sessionMetaSchema.parse(
      JSON.parse(readFileSync(sessionMetaFile({ sessionDir }), 'utf8')),
    )
    expect(meta.id).toBe('stray')
    const threadMeta = threadMetaSchema.parse(
      JSON.parse(
        readFileSync(threadMetaFile({ sessionDir, threadId: toThreadId('stray') }), 'utf8'),
      ),
    )
    expect(threadMeta.agentType).toBe('explore')
  })

  it('orders events by seq even when the database returns them unordered', async () => {
    const fixture = await openFixture()
    await insertThread(fixture, { id: 'root' })
    await insertEvent(fixture, { id: 'e3', threadId: 'root', seq: 3 })
    await insertEvent(fixture, { id: 'e1', threadId: 'root', seq: 1 })
    await insertEvent(fixture, { id: 'e2', threadId: 'root', seq: 2 })

    await exportHarnessDb({ databaseUrl: fixture.database.databaseUrl, home: fixture.home })

    const sessionDir = sessionDirectory({ home: fixture.home, sessionId: 'root' })
    const parsed = parseEventLines({
      text: readFileSync(eventLogFile({ sessionDir, threadId: toThreadId('root') }), 'utf8'),
      threadId: 'root',
    })
    expect(parsed.events.map((event) => String(event.id))).toEqual(['e1', 'e2', 'e3'])
    expect(parsed.head).toBe(3)
  })
})
