import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadDataset } from './dataset-io'
import { registry, resolveSuiteId } from './registry-default'
import { ERunMode, ERunStatus, type ResultRow, type RunSummary } from './results'
import { expandPlan } from './run-plan'
import { assembleSummary, buildRunManifest, failureSummary } from './run-summary'
import { enabledEvalPolicyIds } from '../code-quality/policies'
import { sha256Hex } from './hash'
import { evaluateRun, formatSummaryText, compareRuns } from './summary'
import { loadRunDirectory } from './run-io'
import { validateRawExport } from './integrity'
import { normalizeRows, type RawExport } from './normalize'
import { writeFileAtomic, writeJsonAtomic } from './atomic'

const evalsRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const DEFAULT_CONCURRENCY = 4

async function artifactDigests(): Promise<{ adapterDigest: string; supervisorDigest: string }> {
  const digestOf = async (path: string): Promise<string> => {
    if (!(await pathExists(path))) return 'unbuilt'
    return sha256Hex({ text: await Bun.file(path).text() })
  }
  return {
    adapterDigest: await digestOf(join(evalsRoot, 'dist/child.mjs')),
    supervisorDigest: await digestOf(join(evalsRoot, 'dist/supervisor.mjs')),
  }
}

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
  fakeAnswers?: Record<string, Record<string, unknown>> | undefined
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
  token,
}: {
  manifestPath: string
  workDirectory: string
  stdoutPath: string
  stderrPath: string
  startedAt: Date
  nodePath: string
  token?: string | undefined
}): Promise<ChildCompletion> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(nodePath, [join(evalsRoot, 'dist/child.mjs'), '--manifest', manifestPath], {
      cwd: workDirectory,
      env: {
        ATLAS_HOME: workDirectory,
        PATH: process.env.PATH ?? '',
        ...(token === undefined ? {} : { ATLAS_EVAL_DECISIONS_TOKEN: token }),
      },
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

export async function handleRun({ request }: { request: RunRequest }): Promise<RunResult> {
  const feature = registry.get({ id: resolveSuiteId({ suite: request.suite }) })
  const loaded = await loadDataset({ feature, datasetPath: request.datasetPath ?? null, suite: request.suite })
  const { rows, variants } = expandPlan({ cases: loaded.cases, trials: request.trials })
  if (rows.length === 0) {
    throw new RunFailure(`planned zero rows for suite ${request.suite}; a run requires at least one accepted case`)
  }

  const invocationId = crypto.randomUUID()
  const runDirectory = join(resolve(request.outputParent), invocationId)
  if (await pathExists(runDirectory)) throw new RunFailure(`run directory already exists: ${runDirectory}`)
  await mkdir(runDirectory, { recursive: true })
  await mkdir(join(evalsRoot, '.work'), { recursive: true })
  const workDirectory = await mkdtemp(join(evalsRoot, '.work/'))

  const startedAt = request.now?.() ?? new Date()
  const datasetHash = loaded.manifest.contentHash
  const codeDigests = await artifactDigests()
  const manifest = buildRunManifest({
    request,
    invocationId,
    startedAt,
    rows,
    variants,
    uniqueCases: loaded.cases.length,
    dataset: { version: loaded.manifest.datasetVersion, hash: datasetHash, path: loaded.manifestPath },
    codeDigests,
    enabledPolicyIds: enabledEvalPolicyIds,
    concurrency: DEFAULT_CONCURRENCY,
  })
  const manifestPath = join(runDirectory, 'invocation.manifest.json')
  await writeJsonAtomic({ path: manifestPath, value: manifest })

  const childManifestPath = join(workDirectory, 'child-input.json')
  await writeJsonAtomic({
    path: childManifestPath,
    value: {
      invocationId,
      featureId: feature.id,
      mode: request.mode,
      model: request.model,
      liveConfig: request.liveConfig === undefined ? null : { baseUrl: request.liveConfig.baseUrl },
      deadlineMs: manifest.deadlineMs,
      rows,
      cases: loaded.cases,
      ...(request.fakeAnswers === undefined ? {} : { answers: request.fakeAnswers }),
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
    token: request.liveConfig?.token,
  })

  const childFailureNote =
    completion.code === 0
      ? null
      : `child exited code=${completion.code ?? 'null'} signal=${completion.signal ?? 'none'}; see child.stderr.log`

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
    const notes = childFailureNote === null ? problems : [childFailureNote, ...problems]
    const summary = failureSummary({
      request,
      invocationId,
      dataset: { version: loaded.manifest.datasetVersion, hash: datasetHash },
      notes,
    })
    summary.status = ERunStatus.IntegrityFailure
    await writeJsonAtomic({ path: join(runDirectory, 'summary.json'), value: summary })
    await writeFileAtomic({ path: join(runDirectory, 'summary.txt'), content: formatSummaryText({ summary }) })
    return { runDirectory, summary, rows: [], exitCode: 2 }
  }

  const normalized = normalizeRows({ raw: rawParsed as RawExport, plannedRows: rows })
  const summary = assembleSummary({
    request,
    invocationId,
    feature,
    normalized,
    plannedRows: rows,
    planned: {
      uniqueCases: loaded.cases.length,
      trialsPerCase: request.trials,
      variants,
      datasetVersion: loaded.manifest.datasetVersion,
      datasetHash,
    },
  })

  const verdict = evaluateRun({ summary, gates: loaded.manifest.metricGates })
  summary.status = verdict.status
  summary.failureNotes = verdict.notes
  if (childFailureNote !== null) {
    summary.status = ERunStatus.ExecutionFailure
    summary.failureNotes = [childFailureNote, ...verdict.notes]
  }
  if (request.mode === ERunMode.Fake) summary.promotable = false

  if (request.baselineDir !== undefined) {
    const baseline = await loadRunDirectory({ directory: request.baselineDir })
    const comparison = compareRuns({ baseline, candidate: { summary, rows: normalized, directory: runDirectory } })
    summary.baselineComparison = {
      baselineInvocationId: comparison.baselineInvocationId,
      comparable: comparison.comparable,
      ...(comparison.mismatchReason === undefined ? {} : { mismatchReason: comparison.mismatchReason }),
      deltas: comparison.deltas,
    }
    if (!comparison.verdict.promotable) summary.promotable = false
  }

  const jsonl = normalized.map((row) => JSON.stringify(row)).join('\n') + '\n'
  await writeFileAtomic({ path: join(runDirectory, 'results.jsonl'), content: jsonl })
  await writeJsonAtomic({ path: join(runDirectory, 'summary.json'), value: summary })
  await writeFileAtomic({ path: join(runDirectory, 'summary.txt'), content: formatSummaryText({ summary }) })
  const exitCode = childFailureNote === null ? verdict.exitCode : 2
  return { runDirectory, summary, rows: normalized, exitCode }
}
