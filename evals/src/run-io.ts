import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ERowStatus, ERunMode, ERunStatus, type LoadedRun, type ResultRow, type RunSummary } from './results'

export class RunDirectoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunDirectoryError'
  }
}

const ROW_STATUSES = new Set<string>(Object.values(ERowStatus))

function isRunSummary(value: unknown): value is RunSummary {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<RunSummary>
  return (
    typeof candidate.invocationId === 'string' &&
    typeof candidate.featureId === 'string' &&
    typeof candidate.datasetVersion === 'string' &&
    Object.values(ERunStatus).includes(candidate.status as ERunStatus) &&
    Object.values(ERunMode).includes(candidate.mode as ERunMode) &&
    Array.isArray(candidate.enabledPolicyIds) &&
    typeof candidate.batchMode === 'string' &&
    Array.isArray(candidate.metrics) &&
    Array.isArray(candidate.failureNotes)
  )
}

function isResultRow(value: unknown): value is ResultRow {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ResultRow>
  return (
    typeof candidate.caseId === 'string' &&
    typeof candidate.trialId === 'string' &&
    typeof candidate.variantId === 'string' &&
    typeof candidate.status === 'string' &&
    ROW_STATUSES.has(candidate.status)
  )
}

export async function loadRunDirectory({ directory }: { directory: string }): Promise<LoadedRun> {
  let summaryParsed: unknown
  try {
    summaryParsed = JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8'))
  } catch {
    throw new RunDirectoryError(`no readable summary.json in ${directory}`)
  }
  if (!isRunSummary(summaryParsed)) throw new RunDirectoryError(`summary.json in ${directory} fails the run summary shape`)

  let rowsText = ''
  try {
    rowsText = await readFile(join(directory, 'results.jsonl'), 'utf8')
  } catch {
    rowsText = ''
  }
  const rows: ResultRow[] = []
  for (const line of rowsText.split('\n')) {
    if (line.trim() === '') continue
    const parsed: unknown = JSON.parse(line)
    if (!isResultRow(parsed)) throw new RunDirectoryError(`results.jsonl in ${directory} holds a malformed row`)
    rows.push(parsed)
  }
  return { summary: summaryParsed, rows, directory }
}
