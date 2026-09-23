import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { toThreadId } from '@dltech/atlas-core'

import { Database } from 'bun:sqlite'
import { EVENT_LINE_VERSION, type EventLine } from '../store/sessions/lines'
import {
  SESSION_FORMAT_VERSION,
  writeMeta,
  type SessionMeta,
  type ThreadMeta,
} from '../store/sessions/meta'
import {
  eventLogFile,
  ledgerFile,
  sessionDirectory,
  sessionMetaFile,
  sessionsDirectory,
  threadMetaFile,
  threadsDirectory,
} from '../store/sessions/paths'
import { groupThreadsIntoSessions } from './grouping'
import { LEGACY_IMPORT_MARKER_NAME } from './legacy-import'
import { join } from 'node:path'

type ThreadRow = {
  id: string
  title: string | null
  head: number
  createdAt: string
  updatedAt: string
  parentThreadId: string | null
  forkSeq: number | null
  forkMode: string | null
  spawnerThreadId: string | null
  agentType: string | null
  workspace: string | null
  repo: string | null
  modelRef: string | null
  modelEffort: string | null
  executionLocation: string | null
}

type EventRow = {
  id: string
  threadId: string
  seq: number
  runId: string
  parentRunId: string | null
  depth: number
  at: string
  type: string
  body: string
}

type TurnRow = {
  runId: string
  threadId: string
  status: string
  providerId: string
  modelId: string
  steps: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  startedAt: string
  endedAt: string
  durationMs: number
}

export type LedgerLine = {
  runId: string
  threadId: string
  status: string
  providerId: string
  modelId: string
  steps: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  startedAt: string
  endedAt: string
  durationMs: number
}

export type ExportSummary = {
  sessions: number
  threads: number
  events: number
  turns: number
  malformedBodies: number
  orphanedAgents: number
}

export class ExportVerificationError extends Error {
  constructor(args: { threadId: string; expected: number; written: number }) {
    super(
      `export verification failed for thread ${args.threadId}: source holds ${args.expected} events but ${args.written} lines landed in the file`,
    )
    this.name = 'ExportVerificationError'
  }
}

export async function exportHarnessDb({
  databaseUrl,
  home,
}: {
  databaseUrl: string
  home: string
}): Promise<ExportSummary> {
  const database = new Database(databaseUrl.replace(/^file:/, ''), { readonly: true })
  try {
    const threads = database.query('SELECT * FROM "Thread"').all() as ThreadRow[]
    const { sessions, orphanedAgents } = groupThreadsIntoSessions({ threads })
    const byId = new Map(threads.map((thread) => [thread.id, thread]))

    const summary: ExportSummary = {
      sessions: 0,
      threads: 0,
      events: 0,
      turns: 0,
      malformedBodies: 0,
      orphanedAgents: orphanedAgents.length,
    }

    for (const [sessionId, memberIds] of sessions) {
      const root = byId.get(sessionId)
      if (root === undefined) continue
      const sessionDir = sessionDirectory({ home, sessionId })
      await mkdir(threadsDirectory({ sessionDir }), { recursive: true })

      for (const threadId of memberIds) {
        const thread = byId.get(threadId)
        if (thread === undefined) continue
        const events = database
          .query('SELECT * FROM "Event" WHERE "threadId" = ? ORDER BY "seq" ASC')
          .all(threadId) as EventRow[]

        const lines: string[] = []
        for (const row of events) {
          const body = decodeBody({ raw: row.body })
          if (!body.ok) summary.malformedBodies += 1
          lines.push(JSON.stringify(eventLineOf({ row, body: body.value })))
        }

        const file = eventLogFile({ sessionDir, threadId: toThreadId(threadId) })
        await writeFile(file, lines.length === 0 ? '' : `${lines.join('\n')}\n`)
        await verifyWrittenCount({ file, threadId, expected: events.length })

        await writeMeta({
          file: threadMetaFile({ sessionDir, threadId: toThreadId(threadId) }),
          meta: threadMetaOf({ row: thread }),
        })
        summary.events += events.length
        summary.threads += 1
      }

      const placeholders = memberIds.map(() => '?').join(', ')
      const turns = database
        .query(
          `SELECT * FROM "Turn" WHERE "threadId" IN (${placeholders}) ORDER BY "startedAt" ASC, "runId" ASC`,
        )
        .all(...memberIds) as TurnRow[]
      const ledger = turns.map((turn) => JSON.stringify(ledgerLineOf({ turn })))
      await writeFile(ledgerFile({ sessionDir }), ledger.length === 0 ? '' : `${ledger.join('\n')}\n`)
      summary.turns += turns.length

      await writeMeta({ file: sessionMetaFile({ sessionDir }), meta: sessionMetaOf({ root }) })
      summary.sessions += 1
    }

    await mkdir(sessionsDirectory({ home }), { recursive: true })
    await writeFile(
      join(sessionsDirectory({ home }), LEGACY_IMPORT_MARKER_NAME),
      JSON.stringify({ importedAt: new Date().toISOString(), sessions: summary.sessions }),
    )

    return summary
  } finally {
    database.close()
  }
}

function decodeBody({ raw }: { raw: string }): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false, value: raw }
  }
}

function eventLineOf({ row, body }: { row: EventRow; body: unknown }): EventLine {
  return {
    v: EVENT_LINE_VERSION,
    id: row.id,
    seq: row.seq,
    threadId: row.threadId,
    runId: row.runId,
    ...(row.parentRunId === null ? {} : { parentRunId: row.parentRunId }),
    depth: row.depth,
    at: row.at,
    type: row.type,
    body,
  }
}

function threadMetaOf({ row }: { row: ThreadRow }): ThreadMeta {
  return {
    id: row.id,
    title: row.title,
    head: row.head,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    parentThreadId: row.parentThreadId,
    forkSeq: row.forkSeq,
    forkMode: row.forkMode,
    spawnerThreadId: row.spawnerThreadId,
    agentType: row.agentType,
    workspace: row.workspace,
    repo: row.repo,
    modelRef: row.modelRef,
    modelEffort: row.modelEffort,
    executionLocation: row.executionLocation,
  }
}

function sessionMetaOf({ root }: { root: ThreadRow }): SessionMeta {
  return {
    format: SESSION_FORMAT_VERSION,
    id: root.id,
    title: root.title,
    createdAt: root.createdAt,
    updatedAt: root.updatedAt,
    home: 'local',
    repo: root.repo,
    workspace: root.workspace,
    worktree: null,
    pullRequests: null,
    spend: null,
  }
}

function ledgerLineOf({ turn }: { turn: TurnRow }): LedgerLine {
  return {
    runId: turn.runId,
    threadId: turn.threadId,
    status: turn.status,
    providerId: turn.providerId,
    modelId: turn.modelId,
    steps: turn.steps,
    inputTokens: turn.inputTokens,
    outputTokens: turn.outputTokens,
    cacheReadTokens: turn.cacheReadTokens,
    cacheWriteTokens: turn.cacheWriteTokens,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt,
    durationMs: turn.durationMs,
  }
}

async function verifyWrittenCount({
  file,
  threadId,
  expected,
}: {
  file: string
  threadId: string
  expected: number
}): Promise<void> {
  const text = await readFile(file, 'utf8')
  const written = text.split('\n').filter((line) => line !== '').length
  if (written !== expected) throw new ExportVerificationError({ threadId, expected, written })
}
