import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { sha256Hex } from '../hash'
import { assertSessionDirExists, sortedNames } from './example-files'
import { isRecord } from './historical-events'
import { recoverHistoricalChanges } from './historical-recover'
import {
  EHistoricalRejection,
  type HistoricalChange,
  type HistoricalRejection,
} from './historical-types'
import { assertOutputDirAbsent } from './inventory'

export const HISTORICAL_CHANGES_FILE = 'changes.jsonl'
export const HISTORICAL_REJECTIONS_FILE = 'rejections.jsonl'
export const HISTORICAL_MANIFEST_FILE = 'manifest.json'
export const HISTORICAL_SCHEMA_VERSION = 1

const EVENTS_SUFFIX = '.events.jsonl'
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600

export type HistoricalLogEntry = {
  file: string
  sha256: string
  threadIds: string[]
  lines: number
  changes: number
  rejections: number
}

export type HistoricalSessionEntry = { session: string; logs: HistoricalLogEntry[] }

export type HistoricalManifest = {
  schemaVersion: typeof HISTORICAL_SCHEMA_VERSION
  classification: 'raw_private'
  sanitized: false
  providerReady: false
  notice: string
  sessions: HistoricalSessionEntry[]
  changes: number
  rejections: number
}

export type HistoricalImportReport = {
  outputDir: string
  sessions: number
  logs: number
  changes: number
  rejections: number
}

type Located<TRecord> = TRecord & { session: string; file: string }

type ImportedLog = {
  entry: HistoricalLogEntry
  changes: Located<HistoricalChange>[]
  rejections: Located<HistoricalRejection>[]
}

const NOTICE = 'Raw private extraction containing source code. Not sanitized and not safe to send to any provider.'

function parseLine({ line }: { line: string }): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return line
  }
}

const threadIdOf = (event: unknown): string | null =>
  isRecord(event) && typeof event['threadId'] === 'string' && event['threadId'] !== '' ? event['threadId'] : null

function importLog({ session, file, text }: { session: string; file: string; text: string }): ImportedLog {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const events = lines.map((line) => parseLine({ line }))
  const threadIds = [...new Set(events.map(threadIdOf).filter((id): id is string => id !== null))].sort()
  const recovery = recoverHistoricalChanges({ events })
  const stem = file.slice(0, -EVENTS_SUFFIX.length)
  const mismatched = threadIds.length > 0 && !(threadIds.length === 1 && threadIds[0] === stem)
  const mismatch: HistoricalRejection[] = mismatched
    ? [{ kind: EHistoricalRejection.ThreadFileMismatch, detail: 'event thread ids differ from the log file name', index: 0, seq: null, threadId: threadIds[0] ?? null, callId: null, path: null }]
    : []
  const rejections = [...mismatch, ...recovery.rejections].map((rejection) => ({ ...rejection, session, file }))
  const kept = mismatched ? [] : recovery.changes
  return {
    entry: { file, sha256: sha256Hex({ text }), threadIds, lines: lines.length, changes: kept.length, rejections: rejections.length },
    changes: kept.map((change) => ({ ...change, session, file })),
    rejections,
  }
}

async function listEventLogs({ sessionDir }: { sessionDir: string }): Promise<string[]> {
  const entries = await readdir(join(sessionDir, 'threads'), { withFileTypes: true }).catch(() => [])
  return sortedNames(entries.filter((entry) => entry.isFile() && entry.name.endsWith(EVENTS_SUFFIX)).map((entry) => entry.name))
}

async function readSession({ sessionDir }: { sessionDir: string }): Promise<{ entry: HistoricalSessionEntry; logs: ImportedLog[] }> {
  const session = basename(sessionDir)
  const logs: ImportedLog[] = []
  for (const file of await listEventLogs({ sessionDir })) {
    const text = await readFile(join(sessionDir, 'threads', file), 'utf8')
    logs.push(importLog({ session, file, text }))
  }
  return { entry: { session, logs: logs.map((log) => log.entry) }, logs }
}

const toJsonl = (records: readonly unknown[]): string => records.map((record) => `${JSON.stringify(record)}\n`).join('')

async function writePrivate({ path, content }: { path: string; content: string }): Promise<void> {
  await writeFile(path, content, { encoding: 'utf8', mode: PRIVATE_FILE_MODE, flag: 'wx' })
}

export async function importHistoricalSessions({
  sessionDirs,
  outputDir,
}: {
  sessionDirs: readonly string[]
  outputDir: string
}): Promise<HistoricalImportReport> {
  await assertOutputDirAbsent({ outputDir })
  const sortedDirs = sortedNames(sessionDirs)
  const names = sortedDirs.map((sessionDir) => basename(sessionDir))
  if (new Set(names).size !== names.length) throw new Error('session directory names are not unique')
  for (const sessionDir of sortedDirs) await assertSessionDirExists({ sessionDir })

  const imported = []
  for (const sessionDir of sortedDirs) imported.push(await readSession({ sessionDir }))
  const logs = imported.flatMap((session) => session.logs)
  const changes = logs.flatMap((log) => log.changes)
  const rejections = logs.flatMap((log) => log.rejections)
  const manifest: HistoricalManifest = {
    schemaVersion: HISTORICAL_SCHEMA_VERSION,
    classification: 'raw_private',
    sanitized: false,
    providerReady: false,
    notice: NOTICE,
    sessions: imported.map((session) => session.entry),
    changes: changes.length,
    rejections: rejections.length,
  }

  await mkdir(dirname(outputDir), { recursive: true })
  await mkdir(outputDir, { mode: PRIVATE_DIRECTORY_MODE })
  await writePrivate({ path: join(outputDir, HISTORICAL_CHANGES_FILE), content: toJsonl(changes) })
  await writePrivate({ path: join(outputDir, HISTORICAL_REJECTIONS_FILE), content: toJsonl(rejections) })
  await writePrivate({ path: join(outputDir, HISTORICAL_MANIFEST_FILE), content: `${JSON.stringify(manifest, null, 2)}\n` })
  return { outputDir, sessions: imported.length, logs: logs.length, changes: changes.length, rejections: rejections.length }
}
