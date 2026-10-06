import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadDataset } from './dataset-io'
import { registry } from './registry-default'
import { ERunMode, ERunStatus, ERowStatus, type ResultRow, type RunSummary } from './results'
import { expandPlan, type RunManifest, RUN_MANIFEST_SCHEMA_VERSION } from './run-plan'
import { evaluateRun, formatSummaryText } from './summary'
import { validateRawExport } from './integrity'
import { writeFileAtomic, writeJsonAtomic } from './atomic'
import { timingStats } from './metrics'

const evalsRoot = dirname(dirname(fileURLToPath(import.meta.url)))

export class RunFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunFailure'
  }
}

export type RunRequest = {
  suite: string
  datasetPath?: string | undefined
  trials: number
  outputParent: string
  mode: ERunMode
  model: { requested: string; promotable: boolean }
  liveConfig?: { baseUrl: string; token: string | undefined } | undefined
  deadlineMs?: number | undefined
  baselineDir?: string | undefined
  now?: (() => Date) | undefined
}

export type RunResult = {
  runDirectory: string
  summary: RunSummary
  rows: readonly ResultRow[]
  exitCode: number
}

type ChildCompletion = {
  code: number | null
  signal: NodeJS.Signals | null
  stdoutPath: string
  stderrPath: string
  startedAt: Date
  endedAt: Date
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function spawnChild({
  manifestPath,
  workDirectory,
  stdoutPath,
  stderrPath,
  startedAt,
  nodePath,
}: {
  manifestPath: string
  workDirectory: string
  stdoutPath: string
  stderrPath: string
  startedAt: Date
  nodePath: string
}): Promise<ChildCompletion> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(nodePath, [join(evalsRoot, 'dist/child.mjs'), '--manifest', manifestPath], {
      cwd: workDirectory,
      env: { ATLAS_HOME: workDirectory, PATH: process.env.PATH ?? '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', rejectPromise)
    child.on('close', (code, signal) => {
      void (async () => {
        await writeFile(stdoutPath, Buffer.concat(stdout))
        await writeFile(stderrPath, Buffer.concat(stderr))
        resolvePromise({ code, signal, stdoutPath, stderrPath, startedAt, endedAt: new Date() })
      })().catch(rejectPromise)
    })
  })
}

function buildRunManifest({ request, invocationId, startedAt, rows, variants, uniqueCases, dataset }: {
  request: RunRequest
  invocationId: string
  startedAt: Date
  rows: readonly { caseId: string; trialId: string; variantId: string }[]
  variants: readonly string[]
  uniqueCases: number
  dataset: { version: string; hash: string; path: string }
}): RunManifest {
  return {
    schemaVersion: RUN_MANIFEST_SCHEMA_VERSION,
    invocationId,
    featureId: request.suite,
    mode: request.mode,
    dataset,
    code: { adapterDigest: 'unbuilt', supervisorDigest: 'unbuilt' },
    model: request.model,
    enabledPolicyIds: [],
    batchMode: 'batched',
    planned: { uniqueCases, trialsPerCase: request.trials, variants, rows },
    deadlineMs: request.deadlineMs ?? 10000,
    concurrency: 4,
    cacheDisabled: request.trials > 1,
    startedAt: startedAt.toISOString(),
  }
}

function failureSummary({ request, invocationId, dataset, notes }: {
  request: RunRequest
  invocationId: string
  dataset: { version: string; hash: string }
  notes: readonly string[]
}): RunSummary {
  const emptyTiming = { p50: null, p95: null, samples: 0 }
  return {
    status: ERunStatus.ExecutionFailure,
    invocationId,
    featureId: request.suite,
    datasetVersion: dataset.version,
    datasetHash: dataset.hash,
    model: { requested: request.model.requested, resolved: null },
    mode: request.mode,
    planned: { uniqueCases: 0, rows: 0, trialsPerCase: request.trials, variants: [] },
    completed: 0,
    errors: 0,
    inconclusive: 0,
    operationalFailures: 0,
    repeatFlips: 0,
    metrics: [],
    datasetAggregates: [],
    failures: [],
    timing: {
      preparationMs: emptyTiming,
      inferenceMs: emptyTiming,
      interpretationMs: emptyTiming,
      gradingMs: emptyTiming,
      endToEndMs: emptyTiming,
      childOverheadMs: 0,
    },
    baselineComparison: null,
    promotable: false,
    failureNotes: notes,
  }
}

export async function handleRun({ request }: { request: RunRequest }): Promise<RunResult> {
  const feature = registry.get({ id: request.suite })
  const loaded = await loadDataset({ feature, datasetPath: request.datasetPath ?? null, suite: request.suite })
  const { rows, variants } = expandPlan({ cases: loaded.cases, trials: request.trials })

  const invocationId = crypto.randomUUID()
  const runDirectory = join(resolve(request.outputParent), invocationId)
  if (await pathExists(runDirectory)) throw new RunFailure(`run directory already exists: ${runDirectory}`)
  await mkdir(runDirectory, { recursive: true })
  const workDirectory = await mkdtemp(join(evalsRoot, '.work/'))

  const startedAt = request.now?.() ?? new Date()
  const datasetHash = loaded.manifest.contentHash
  const manifest = buildRunManifest({
    request,
    invocationId,
    startedAt,
    rows,
    variants,
    uniqueCases: loaded.cases.length,
    dataset: { version: loaded.manifest.datasetVersion, hash: datasetHash, path: loaded.manifestPath },
  })
  const manifestPath = join(runDirectory, 'invocation.manifest.json')
  await writeJsonAtomic({ path: manifestPath, value: manifest })

  const childManifestPath = join(workDirectory, 'child-input.json')
  await writeJsonAtomic({
    path: childManifestPath,
    value: {
      invocationId,
      featureId: request.suite,
      mode: request.mode,
      model: request.model,
      liveConfig: request.liveConfig ?? null,
      deadlineMs: manifest.deadlineMs,
      rows,
      cases: loaded.cases,
      outputPath: join(runDirectory, 'evalite.raw.json'),
      runStartedAt: startedAt.toISOString(),
    },
  })

  const completion = await spawnChild({
    manifestPath: childManifestPath,
    workDirectory,
    stdoutPath: join(runDirectory, 'child.stdout.log'),
    stderrPath: join(runDirectory, 'child.stderr.log'),
    startedAt,
    nodePath: process.env.ATLAS_EVAL_NODE ?? 'node',
  })

  if (completion.code !== 0) {
    const summary = failureSummary({
      request,
      invocationId,
      dataset: { version: loaded.manifest.datasetVersion, hash: datasetHash },
      notes: [`child exited code=${completion.code ?? 'null'} signal=${completion.signal ?? 'none'}; see child.stderr.log`],
    })
    await writeJsonAtomic({ path: join(runDirectory, 'summary.json'), value: summary })
    await writeFileAtomic({ path: join(runDirectory, 'summary.txt'), content: formatSummaryText({ summary }) })
    return { runDirectory, summary, rows: [], exitCode: 2 }
  }

  const rawPath = join(runDirectory, 'evalite.raw.json')
  const rawText = (await pathExists(rawPath)) ? await Bun.file(rawPath).text() : null
  let rawParsed: unknown = null
  if (rawText !== null) {
    try {
      rawParsed = JSON.parse(rawText)
    } catch {
      rawParsed = undefined
    }
  }

  const integrity = validateRawExport({
    parsed: rawParsed,
    startedAfter: startedAt.toISOString(),
    plannedRows: rows,
  })

  const problems = [...integrity.problems.map((problem) => `${problem.kind}: ${problem.detail}`)]
  if (rawText === null) problems.push('missing_artifact: evalite.raw.json was not written')

  if (problems.length > 0) {
    const summary = failureSummary({
      request,
      invocationId,
      dataset: { version: loaded.manifest.datasetVersion, hash: datasetHash },
      notes: problems,
    })
    summary.status = ERunStatus.IntegrityFailure
    await writeJsonAtomic({ path: join(runDirectory, 'summary.json'), value: summary })
    await writeFileAtomic({ path: join(runDirectory, 'summary.txt'), content: formatSummaryText({ summary }) })
    return { runDirectory, summary, rows: [], exitCode: 2 }
  }

  const normalized = await normalizeRows({ runDirectory })
  const completedRows = normalized.filter((row) => row.status === ERowStatus.Completed)
  const errorRows = normalized.filter((row) => row.status !== ERowStatus.Completed)

  const emptyStats = { p50: null, p95: null, samples: 0 }
  const summary: RunSummary = {
    status: ERunStatus.Complete,
    invocationId,
    featureId: request.suite,
    datasetVersion: loaded.manifest.datasetVersion,
    datasetHash,
    model: { requested: request.model.requested, resolved: resolvedModelOf({ rows: normalized }) },
    mode: request.mode,
    planned: {
      uniqueCases: loaded.cases.length,
      rows: rows.length,
      trialsPerCase: request.trials,
      variants,
    },
    completed: completedRows.length,
    errors: errorRows.length,
    inconclusive: 0,
    operationalFailures: errorRows.length,
    repeatFlips: 0,
    metrics: [],
    datasetAggregates: [],
    failures: [],
    timing: {
      preparationMs: timingStats({ samples: completedRows.map((row) => row.timing.preparationMs) }),
      inferenceMs: timingStats({ samples: completedRows.map((row) => row.timing.inferenceMs) }),
      interpretationMs: timingStats({ samples: completedRows.map((row) => row.timing.interpretationMs) }),
      gradingMs: emptyStats,
      endToEndMs: timingStats({ samples: completedRows.map((row) => row.timing.endToEndMs) }),
      childOverheadMs: 0,
    },
    baselineComparison: null,
    promotable: request.model.promotable && request.mode === ERunMode.Live,
    failureNotes: [],
  }

  const verdict = evaluateRun({ summary, gates: loaded.manifest.metricGates })
  summary.status = verdict.status
  summary.failureNotes = verdict.notes
  if (request.mode === ERunMode.Fake) summary.promotable = false

  const jsonl = normalized.map((row) => JSON.stringify(row)).join('\n') + '\n'
  await writeFileAtomic({ path: join(runDirectory, 'results.jsonl'), content: jsonl })
  await writeJsonAtomic({ path: join(runDirectory, 'summary.json'), value: summary })
  await writeFileAtomic({ path: join(runDirectory, 'summary.txt'), content: formatSummaryText({ summary }) })
  return { runDirectory, summary, rows: normalized, exitCode: verdict.exitCode }
}

function resolvedModelOf({ rows }: { rows: readonly ResultRow[] }): string | null {
  for (const row of rows) {
    if (row.rawAnswersRef === undefined || row.rawAnswersRef === null) continue
    return row.rawAnswersRef
  }
  return null
}

async function normalizeRows({ runDirectory }: { runDirectory: string }): Promise<readonly ResultRow[]> {
  const path = join(runDirectory, 'rows.normalized.json')
  if (!(await pathExists(path))) return []
  const parsed: unknown = JSON.parse(await Bun.file(path).text())
  if (!Array.isArray(parsed)) return []
  return parsed as readonly ResultRow[]
}
