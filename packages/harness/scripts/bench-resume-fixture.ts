import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { toEventId, toRunId, toThreadId, type EventDraft, type EventEnvelope, type ThreadId } from '@dltech/atlas-core'

import { encodeEventLine } from '../src/store/sessions/lines'
import { newThreadMeta, type SessionMeta, type ThreadMeta } from '../src/store/sessions/meta'
import { eventLogFile, ledgerFile, sessionDirectory, sessionMetaFile, threadMetaFile } from '../src/store/sessions/paths'

export const SESSION_COUNT = 1200
export const ROOTS_PER_PROJECT = 600
export const CHILDREN_PER_ROOT = 2
export const BIG_LOG_COUNT = 50
export const LIST_LIMIT = 50

const LOG_TARGET_BYTES = 2 * 1024 * 1024
const SMALL_NOISE_EVENTS = 40
const SMALL_NOISE_TEXT = 'bench noise '.repeat(10)
const LEDGER_TURNS = 4

export type BenchPaths = { root: string; child: string }

export type FixtureTotals = { bytes: number; eventLines: number; metaFiles: number }

export function isoOf({ day, tick }: { day: number; tick: number }): string {
  return new Date(Date.UTC(2026, 0, 1 + day, tick % 24, 0, 0, tick)).toISOString()
}

function rootMeta({ id, projects, index }: { id: string; projects: BenchPaths; index: number }): ThreadMeta {
  return {
    ...newThreadMeta({ id, at: isoOf({ day: index, tick: 0 }) }),
    title: `bench thread ${index}`,
    head: 5,
    updatedAt: isoOf({ day: index, tick: 5000 + (index % 60) }),
    workspace: index < ROOTS_PER_PROJECT ? projects.root : projects.child,
    repo: index < ROOTS_PER_PROJECT ? projects.root : projects.child,
  }
}

function childMeta({
  id,
  parentId,
  projects,
  index,
  number,
}: {
  id: string
  parentId: string
  projects: BenchPaths
  index: number
  number: number
}): ThreadMeta {
  return {
    ...newThreadMeta({ id, at: isoOf({ day: index, tick: 1 }) }),
    title: `bench child ${index}-${number}`,
    head: 1,
    updatedAt: isoOf({ day: index, tick: 2000 + number }),
    spawnerThreadId: parentId,
    agentType: 'explorer',
    workspace: projects.child,
    repo: projects.child,
  }
}

function envelopeOf({ threadId, seq, runId }: { threadId: ThreadId; seq: number; runId: string }): EventEnvelope {
  return {
    id: toEventId(`evt_${threadId.slice(4)}_${seq}`),
    seq,
    threadId,
    runId: toRunId(runId),
    depth: 0,
    at: isoOf({ day: seq, tick: seq }),
  }
}

function lineOf({ draft, envelope }: { draft: EventDraft; envelope: EventEnvelope }): string {
  return `${encodeEventLine({ draft, envelope })}\n`
}

function headLines({ threadId, index }: { threadId: ThreadId; index: number }): string[] {
  const runId = `run_${threadId.slice(4)}`
  return [
    lineOf({
      draft: {
        type: 'worktree-entered',
        path: `/bench/.atlas/worktrees/bench-${index}`,
        branch: `dennis/bench-${index}`,
        base: 'origin/main',
      },
      envelope: envelopeOf({ threadId, seq: 1, runId }),
    }),
    lineOf({
      draft: {
        type: 'pull-request-linked',
        number: 4000 + index,
        url: `https://github.com/acme/bench/pull/${4000 + index}`,
        repo: 'github.com/acme/bench',
        branch: `dennis/bench-${index}`,
      },
      envelope: envelopeOf({ threadId, seq: 2, runId }),
    }),
  ]
}

function tailLines({ threadId, seqStart }: { threadId: ThreadId; seqStart: number }): string[] {
  const runId = `run_${threadId.slice(4)}`
  return [
    lineOf({ draft: { type: 'user-said', text: 'tail chatter' }, envelope: envelopeOf({ threadId, seq: seqStart, runId }) }),
    lineOf({
      draft: { type: 'assistant-said', parts: [{ type: 'text', text: 'tail answer' }] },
      envelope: envelopeOf({ threadId, seq: seqStart + 1, runId }),
    }),
  ]
}

function buildBigLog({ threadId, index }: { threadId: ThreadId; index: number }): { text: string; lines: number } {
  const head = headLines({ threadId, index })
  const envelope = envelopeOf({ threadId, seq: 3, runId: `run_${threadId.slice(4)}` })
  const prefix = `${encodeEventLine({ draft: { type: 'assistant-said', parts: [{ type: 'text', text: '' }] }, envelope })}`
  const padding = 'x'.repeat(Math.max(0, LOG_TARGET_BYTES - prefix.length - 2))
  const giant = `${encodeEventLine({ draft: { type: 'assistant-said', parts: [{ type: 'text', text: padding }] }, envelope })}\n`
  const text = [...head, giant, ...tailLines({ threadId, seqStart: 4 })].join('')
  return { text, lines: 5 }
}

function buildSmallLog({ threadId, index }: { threadId: ThreadId; index: number }): { text: string; lines: number } {
  const lines = headLines({ threadId, index })
  let seq = 2
  for (let count = 0; count < SMALL_NOISE_EVENTS; count += 1) {
    seq += 1
    lines.push(
      lineOf({
        draft: { type: 'assistant-said', parts: [{ type: 'text', text: SMALL_NOISE_TEXT }] },
        envelope: envelopeOf({ threadId, seq, runId: `run_${threadId.slice(4)}` }),
      }),
    )
  }
  const text = [...lines, ...tailLines({ threadId, seqStart: seq + 1 })].join('')
  return { text, lines: seq + 2 }
}

function sessionMetaOf({ id, index }: { id: string; index: number }): SessionMeta {
  return {
    format: 1,
    id,
    title: `bench thread ${index}`,
    createdAt: isoOf({ day: index, tick: 0 }),
    updatedAt: isoOf({ day: index, tick: 5000 }),
    home: 'host',
    repo: '/bench',
    workspace: '/bench',
    worktree: `/bench/.atlas/worktrees/bench-${index}`,
    pullRequests: null,
    spend: null,
  }
}

function ledgerTextOf({ id, index }: { id: string; index: number }): string {
  return Array.from({ length: LEDGER_TURNS }, (_, turn) =>
    `${JSON.stringify({
      v: 1,
      runId: `run_${id.slice(4)}_${turn}`,
      threadId: id,
      status: 'completed',
      providerId: 'bench',
      modelId: 'bench-model',
      steps: 1,
      inputTokens: 1000 + turn,
      outputTokens: 50 + turn,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      startedAt: isoOf({ day: index, tick: turn }),
      endedAt: isoOf({ day: index, tick: turn + 1 }),
      durationMs: 1,
    })}\n`,
  ).join('')
}

async function writeSession({ home, projects, index }: { home: string; projects: BenchPaths; index: number }): Promise<FixtureTotals> {
  const id = `brn_bench_${String(index).padStart(6, '0')}`
  const sessionDir = sessionDirectory({ home, sessionId: id })
  const sessionId = toThreadId(id)
  await mkdir(join(sessionDir, 'threads'), { recursive: true })

  const isRoot = index < ROOTS_PER_PROJECT
  const isBig = isRoot && index >= ROOTS_PER_PROJECT - BIG_LOG_COUNT
  const log = isBig ? buildBigLog({ threadId: sessionId, index }) : buildSmallLog({ threadId: sessionId, index })
  const metaFiles = 1 + CHILDREN_PER_ROOT + (isBig ? 1 : 0)
  const writes: Promise<unknown>[] = [
    writeFile(threadMetaFile({ sessionDir, threadId: sessionId }), JSON.stringify(rootMeta({ id, projects, index }), null, 2)),
    writeFile(eventLogFile({ sessionDir, threadId: sessionId }), log.text),
  ]
  if (isBig) {
    writes.push(writeFile(sessionMetaFile({ sessionDir }), JSON.stringify(sessionMetaOf({ id, index }), null, 2)))
    writes.push(writeFile(ledgerFile({ sessionDir }), ledgerTextOf({ id, index })))
  }
  for (let number = 0; number < CHILDREN_PER_ROOT; number += 1) {
    const childId = `brn_bench_${String(index).padStart(6, '0')}_c${number}`
    writes.push(
      writeFile(
        threadMetaFile({ sessionDir, threadId: toThreadId(childId) }),
        JSON.stringify(childMeta({ id: childId, parentId: id, projects, index, number }), null, 2),
      ),
    )
  }
  await Promise.all(writes)
  return { bytes: Buffer.byteLength(log.text), eventLines: log.lines, metaFiles }
}

export async function buildFixture({ home, projects }: { home: string; projects: BenchPaths }): Promise<FixtureTotals> {
  const totals: FixtureTotals = { bytes: 0, eventLines: 0, metaFiles: 0 }
  const batchSize = 100
  for (let start = 0; start < SESSION_COUNT; start += batchSize) {
    const batch = Array.from({ length: Math.min(batchSize, SESSION_COUNT - start) }, (_, offset) => start + offset)
    for (const done of await Promise.all(batch.map((index) => writeSession({ home, projects, index })))) {
      totals.bytes += done.bytes
      totals.eventLines += done.eventLines
      totals.metaFiles += done.metaFiles
    }
  }
  return totals
}
