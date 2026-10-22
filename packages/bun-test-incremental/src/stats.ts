import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { EMode } from './types'

export function emptyStats() {
  return {
    testFiles: 0,
    reused: 0,
    executedFiles: [] as string[],
    failedFiles: [] as string[],
    recorded: 0,
    notRecorded: 0,
    missReasons: {} as Record<string, number>,
    decisions: [] as string[],
  }
}

export type Stats = ReturnType<typeof emptyStats>

export function countMiss(params: { stats: Stats; reason: string }) {
  const { stats, reason } = params
  const category = reason.startsWith('changed: ') ? 'inputs changed' : reason
  stats.missReasons[category] = (stats.missReasons[category] ?? 0) + 1
}

export function report(params: {
  stats: Stats
  mode: EMode
  project: string
  globalKey: string
  workDir: string
  summaryFile: string | undefined
  startedAt: number
}) {
  const { stats, mode, project, globalKey, workDir, summaryFile, startedAt } = params
  mkdirSync(workDir, { recursive: true })
  const log = join(workDir, 'decisions.log')
  writeFileSync(log, `${stats.decisions.join('\n')}\n`)
  const verb = mode === EMode.Plan ? 'would run' : 'run'
  console.log(
    `[incremental] ${project}: ${stats.testFiles} files, ${stats.reused} reused, ` +
      `${stats.executedFiles.length} ${verb}, ${stats.recorded} recorded (decisions: ${log})`,
  )
  if (!summaryFile) return
  const { decisions: _decisions, missReasons: _miss, ...counts } = stats
  const summary = {
    project,
    globalKey,
    mode,
    ...counts,
    executed: stats.executedFiles.length,
    timings: { totalMs: Date.now() - startedAt },
  }
  mkdirSync(dirname(summaryFile), { recursive: true })
  writeFileSync(summaryFile, JSON.stringify(summary, null, 2))
}
