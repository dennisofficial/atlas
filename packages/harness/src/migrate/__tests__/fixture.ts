import { afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openAtlasDatabase, type AtlasDatabase } from '../../store/database'

export const AT = '2026-09-20T10:00:00.000Z'

export type Fixture = {
  database: AtlasDatabase
  dbDir: string
  home: string
  close: () => Promise<void>
}

const fixtures: Fixture[] = []

export async function openFixture(): Promise<Fixture> {
  const dbDir = mkdtempSync(join(tmpdir(), 'atlas-export-db-'))
  const home = mkdtempSync(join(tmpdir(), 'atlas-export-home-'))
  const database = await openAtlasDatabase({ databaseUrl: `file:${join(dbDir, 'harness.db')}` })
  const fixture: Fixture = {
    database,
    dbDir,
    home,
    close: async () => {
      await database.close()
      rmSync(dbDir, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    },
  }
  fixtures.push(fixture)
  return fixture
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

export async function insertThread(
  fixture: Fixture,
  args: {
    id: string
    title?: string
    spawnerThreadId?: string
    agentType?: string
    parentThreadId?: string
    forkSeq?: number
    forkMode?: string
    workspace?: string
    repo?: string
  },
): Promise<void> {
  await fixture.database.prisma.thread.create({
    data: {
      id: args.id,
      title: args.title ?? null,
      createdAt: AT,
      updatedAt: AT,
      spawnerThreadId: args.spawnerThreadId ?? null,
      agentType: args.agentType ?? null,
      parentThreadId: args.parentThreadId ?? null,
      forkSeq: args.forkSeq ?? null,
      forkMode: args.forkMode ?? null,
      workspace: args.workspace ?? null,
      repo: args.repo ?? null,
    },
  })
}

export async function insertEvent(
  fixture: Fixture,
  args: { id: string; threadId: string; seq: number; body?: string; parentRunId?: string },
): Promise<void> {
  await fixture.database.prisma.event.create({
    data: {
      id: args.id,
      threadId: args.threadId,
      seq: args.seq,
      runId: `run-${args.threadId}`,
      parentRunId: args.parentRunId ?? null,
      depth: 0,
      at: AT,
      type: 'user-said',
      body: args.body ?? JSON.stringify({ type: 'user-said', text: `event ${args.seq}` }),
    },
  })
}

export async function insertTurn(
  fixture: Fixture,
  args: { runId: string; threadId: string; startedAt: string },
): Promise<void> {
  await fixture.database.prisma.turn.create({
    data: {
      runId: args.runId,
      threadId: args.threadId,
      status: 'completed',
      providerId: 'anthropic',
      modelId: 'claude-opus-5',
      steps: 2,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 80,
      cacheWriteTokens: 20,
      startedAt: args.startedAt,
      endedAt: AT,
      durationMs: 500,
    },
  })
}

export async function seedFamily(fixture: Fixture): Promise<void> {
  await insertThread(fixture, {
    id: 'root',
    title: 'main conversation',
    workspace: '/repo',
    repo: 'dennisofficial/atlas',
  })
  await insertThread(fixture, { id: 'agent', spawnerThreadId: 'root', agentType: 'explore' })
  await insertThread(fixture, { id: 'subagent', spawnerThreadId: 'agent', agentType: 'builder' })
  await insertThread(fixture, {
    id: 'fork',
    title: 'fork of main',
    parentThreadId: 'root',
    forkSeq: 2,
    forkMode: 'full',
  })
  await insertEvent(fixture, { id: 'e1', threadId: 'root', seq: 1 })
  await insertEvent(fixture, { id: 'e2', threadId: 'root', seq: 2 })
  await insertEvent(fixture, { id: 'e3', threadId: 'agent', seq: 1, parentRunId: 'run-root' })
  await insertEvent(fixture, { id: 'e4', threadId: 'subagent', seq: 1 })
  await insertEvent(fixture, { id: 'e5', threadId: 'fork', seq: 1 })
  await insertTurn(fixture, { runId: 'run-root', threadId: 'root', startedAt: AT })
  await insertTurn(fixture, { runId: 'run-agent', threadId: 'agent', startedAt: '2026-09-20T11:00:00.000Z' })
}
