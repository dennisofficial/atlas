import { afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Database } from 'bun:sqlite'

export const AT = '2026-09-20T10:00:00.000Z'

const DDL = `
CREATE TABLE "Thread" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT,
  "head" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "parentThreadId" TEXT,
  "forkSeq" INTEGER,
  "forkMode" TEXT,
  "spawnerThreadId" TEXT,
  "agentType" TEXT,
  "workspace" TEXT,
  "repo" TEXT,
  "modelRef" TEXT,
  "modelEffort" TEXT,
  "executionLocation" TEXT
);
CREATE TABLE "Event" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "threadId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "runId" TEXT NOT NULL,
  "parentRunId" TEXT,
  "depth" INTEGER NOT NULL,
  "at" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "contextSlot" TEXT,
  "contextKey" TEXT,
  "contextDigest" TEXT
);
CREATE TABLE "Turn" (
  "runId" TEXT NOT NULL PRIMARY KEY,
  "threadId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "steps" INTEGER NOT NULL,
  "inputTokens" INTEGER NOT NULL,
  "outputTokens" INTEGER NOT NULL,
  "cacheReadTokens" INTEGER NOT NULL,
  "cacheWriteTokens" INTEGER NOT NULL,
  "startedAt" TEXT NOT NULL,
  "endedAt" TEXT NOT NULL,
  "durationMs" INTEGER NOT NULL
);
`

export type Fixture = {
  database: Database
  databaseFile: string
  dbDir: string
  home: string
  close: () => Promise<void>
}

const fixtures: Fixture[] = []

export function openFixture(): Fixture {
  const dbDir = mkdtempSync(join(tmpdir(), 'atlas-export-db-'))
  const home = mkdtempSync(join(tmpdir(), 'atlas-export-home-'))
  const databaseFile = join(dbDir, 'harness.db')
  const database = new Database(databaseFile)
  database.exec(DDL)
  const fixture: Fixture = {
    database,
    databaseFile,
    dbDir,
    home,
    close: () => {
      database.close()
      rmSync(dbDir, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
      return Promise.resolve()
    },
  }
  fixtures.push(fixture)
  return fixture
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

export function insertThread(
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
): void {
  fixture.database
    .query(
      `INSERT INTO "Thread" ("id", "title", "createdAt", "updatedAt", "spawnerThreadId", "agentType", "parentThreadId", "forkSeq", "forkMode", "workspace", "repo")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.id,
      args.title ?? null,
      AT,
      AT,
      args.spawnerThreadId ?? null,
      args.agentType ?? null,
      args.parentThreadId ?? null,
      args.forkSeq ?? null,
      args.forkMode ?? null,
      args.workspace ?? null,
      args.repo ?? null,
    )
}

export function insertEvent(
  fixture: Fixture,
  args: { id: string; threadId: string; seq: number; body?: string; parentRunId?: string },
): void {
  fixture.database
    .query(
      `INSERT INTO "Event" ("id", "threadId", "seq", "runId", "parentRunId", "depth", "at", "type", "body")
       VALUES (?, ?, ?, ?, ?, 0, ?, 'user-said', ?)`,
    )
    .run(
      args.id,
      args.threadId,
      args.seq,
      `run-${args.threadId}`,
      args.parentRunId ?? null,
      AT,
      args.body ?? JSON.stringify({ type: 'user-said', text: `event ${args.seq}` }),
    )
}

export function insertTurn(
  fixture: Fixture,
  args: { runId: string; threadId: string; startedAt: string },
): void {
  fixture.database
    .query(
      `INSERT INTO "Turn" ("runId", "threadId", "status", "providerId", "modelId", "steps", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "startedAt", "endedAt", "durationMs")
       VALUES (?, ?, 'completed', 'anthropic', 'claude-opus-5', 2, 100, 50, 80, 20, ?, ?, 500)`,
    )
    .run(args.runId, args.threadId, args.startedAt, AT)
}

export function seedFamily(fixture: Fixture): void {
  insertThread(fixture, {
    id: 'root',
    title: 'main conversation',
    workspace: '/repo',
    repo: 'dennisofficial/atlas',
  })
  insertThread(fixture, { id: 'agent', spawnerThreadId: 'root', agentType: 'explore' })
  insertThread(fixture, { id: 'subagent', spawnerThreadId: 'agent', agentType: 'builder' })
  insertThread(fixture, {
    id: 'fork',
    title: 'fork of main',
    parentThreadId: 'root',
    forkSeq: 2,
    forkMode: 'full',
  })
  insertEvent(fixture, { id: 'e1', threadId: 'root', seq: 1 })
  insertEvent(fixture, { id: 'e2', threadId: 'root', seq: 2 })
  insertEvent(fixture, { id: 'e3', threadId: 'agent', seq: 1, parentRunId: 'run-root' })
  insertEvent(fixture, { id: 'e4', threadId: 'subagent', seq: 1 })
  insertEvent(fixture, { id: 'e5', threadId: 'fork', seq: 1 })
  insertTurn(fixture, { runId: 'run-root', threadId: 'root', startedAt: AT })
  insertTurn(fixture, { runId: 'run-agent', threadId: 'agent', startedAt: '2026-09-20T11:00:00.000Z' })
}
