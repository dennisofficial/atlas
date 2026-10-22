/**
 * The incremental runner, registered by `incrementalTests()` as a reporter so
 * Vitest loads it (TypeScript included). In `onInit` it wraps the configured
 * sequencer, whose `sort` decides which files run, and adds the recorder setup
 * file to each opted-in project. After the run it records new passes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  Reporter,
  TestModule,
  TestProject,
  TestSequencer,
  TestSpecification,
  Vitest,
} from 'vitest/node'
import type { IncrementalTestsOptions } from '../index'
import { Hasher } from './fingerprint'
import { computeGlobalKey } from './global-key'
import { buildEntry, modulePassed } from './record'
import { ResultStore } from './store'
import './types'

/** `run`: reuse valid passes. `force`: run all, record. `plan`: decide and log, run nothing. */
type Mode = 'run' | 'force' | 'plan'

/** Built by index.js: session-wide settings (paths resolved, equal across projects) plus per-project options. */
export interface ReporterOptions
  extends Pick<IncrementalTestsOptions, 'repoRoot' | 'cacheDir' | 'summaryFile'> {
  mode: Mode | 'clear'
  projects: Map<TestProject, IncrementalTestsOptions>
}

interface ProjectState {
  name: string
  globalKey: string
  store: ResultStore
  workDir: string
  stats: ReturnType<typeof emptyStats>
}

const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

function emptyStats() {
  return {
    testFiles: 0,
    reused: 0,
    executedFiles: [] as string[],
    failedFiles: [] as string[],
    recorded: 0,
    notRecorded: 0,
    missReasons: {} as Record<string, number>,
    decisions: [] as string[],
    validationMs: 0,
  }
}

function findRepoRoot(start: string) {
  for (let dir = start; ; dir = dirname(dir)) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest) && 'workspaces' in JSON.parse(readFileSync(manifest, 'utf8')))
      return dir
    if (dirname(dir) === dir) return start
  }
}

export default class IncrementalReporter implements Reporter {
  private readonly projects = new Map<TestProject, ProjectState>()
  private vitest!: Vitest
  private repoRoot = ''
  private mode: Mode = 'run'
  private hasher = new Hasher('')
  private runStart = Date.now()
  private partialFiles = new Set<string>()

  constructor(private readonly options: ReporterOptions) {}

  onInit(vitest: Vitest) {
    this.vitest = vitest
    this.repoRoot = this.options.repoRoot ?? findRepoRoot(vitest.config.root)
    const cacheDir = this.options.cacheDir ?? join(this.repoRoot, '.cache/incremental-tests')
    if (this.options.mode === 'clear') ResultStore.clear(cacheDir)
    ResultStore.claim(cacheDir)
    this.mode = this.options.mode === 'clear' ? 'force' : this.options.mode
    // Plan mode runs nothing by design; Vitest would otherwise exit 1 on a cold cache.
    if (this.mode === 'plan') vitest.config.passWithNoTests = true

    const shouldRun = (spec: TestSpecification) => this.shouldRun(spec)
    const Configured = vitest.config.sequence.sequencer
    vitest.config.sequence.sequencer = class IncrementalSequencer implements TestSequencer {
      private readonly inner: TestSequencer
      constructor(ctx: Vitest) {
        this.inner = new Configured(ctx)
      }
      shard = (files: TestSpecification[]) => this.inner.shard(files)
      sort = (files: TestSpecification[]) => this.inner.sort(files.filter(shouldRun))
    }

    for (const [project, projectOptions] of this.options.projects) {
      const name = relative(this.repoRoot, project.config.root) || '.'
      const viteConfigs = [project.vite.config, vitest.vite.config]
      const { key } = computeGlobalKey({
        repoRoot: this.repoRoot,
        projectRoot: project.config.root,
        pluginDir: PLUGIN_DIR,
        // globalSetup runs once in this process, outside every test file's record.
        configFiles: viteConfigs
          .flatMap((c) => [c.configFile ?? '', ...c.configFileDependencies])
          .concat(project.config.globalSetup)
          .filter(Boolean),
        globalInputs: projectOptions.globalInputs ?? [],
        env: projectOptions.env ?? [],
        vitestVersion: vitest.version,
      })
      const slug = name.replace(/[^\w.-]+/g, '-')
      this.projects.set(project, {
        name,
        globalKey: key,
        store: new ResultStore(join(cacheDir, slug, key)),
        workDir: join(cacheDir, 'work', slug),
        stats: emptyStats(),
      })
      project.provide('incrementalRepoRoot', this.repoRoot)
      project.config.setupFiles.unshift(join(PLUGIN_DIR, 'src/recorder.ts'))
    }
  }

  private shouldRun(spec: TestSpecification) {
    const state = this.projects.get(spec.project)
    if (!state) return true
    const start = performance.now()
    const test = relative(this.repoRoot, spec.moduleId)
    const lookup =
      this.mode === 'force'
        ? { status: 'miss' as const, reason: 'forced' }
        : state.store.lookup(test, this.hasher, process.env)
    const { stats } = state
    stats.testFiles++
    stats.validationMs += performance.now() - start
    if (lookup.status === 'hit') {
      // Vitest exits 1 when no file ran; reusing every result is not that case.
      this.vitest.config.passWithNoTests = true
      stats.reused++
      stats.decisions.push(`skip ${test} (passed ${lookup.entry.passedAt})`)
      return false
    }
    stats.executedFiles.push(test)
    stats.decisions.push(`run  ${test} (${lookup.reason})`)
    const category = lookup.reason.startsWith('changed: ') ? 'inputs changed' : lookup.reason
    stats.missReasons[category] = (stats.missReasons[category] ?? 0) + 1
    return this.mode !== 'plan'
  }

  onTestRunStart(specifications: ReadonlyArray<TestSpecification>) {
    this.runStart = Date.now()
    this.hasher = new Hasher(this.repoRoot)
    // A line filter (`file.test.ts:12`) runs part of a file; its pass proves nothing about the rest.
    this.partialFiles = new Set(
      specifications.filter((s) => s.testLines?.length).map((s) => s.moduleId),
    )
    for (const state of this.projects.values()) state.stats = emptyStats()
  }

  onTestRunEnd(
    testModules: ReadonlyArray<TestModule>,
    unhandledErrors: ReadonlyArray<unknown>,
    reason: 'passed' | 'interrupted' | 'failed',
  ) {
    const recordStart = performance.now()
    // Vitest attributes most unhandled errors to the test file that was running.
    const attributed = unhandledErrors.map((error) =>
      error && typeof error === 'object' && 'VITEST_TEST_PATH' in error
        ? String(error.VITEST_TEST_PATH)
        : null,
    )
    const cacheable =
      reason !== 'interrupted' &&
      !attributed.includes(null) &&
      !this.vitest.config.testNamePattern &&
      this.mode !== 'plan'
    const postRun = new Hasher(this.repoRoot)
    const reported = new Set<string>()
    for (const testModule of testModules) {
      const state = this.projects.get(testModule.project)
      if (!state) continue
      const test = relative(this.repoRoot, testModule.moduleId)
      reported.add(test)
      if (!modulePassed(testModule) || attributed.includes(testModule.moduleId)) {
        state.stats.failedFiles.push(test)
        continue
      }
      if (!cacheable || this.partialFiles.has(testModule.moduleId)) continue
      const entry = buildEntry({
        testModule,
        repoRoot: this.repoRoot,
        runStart: this.runStart,
        hasher: postRun,
      })
      if (typeof entry === 'string') {
        state.stats.notRecorded++
        const spawned = testModule.meta().incremental?.spawned ?? []
        this.vitest.logger.log(
          `[incremental] not caching ${test}: ${entry}${spawned.length ? ` (${spawned.slice(0, 3).join(' | ')})` : ''}`,
        )
        continue
      }
      if (!state.store.write(test, entry)) {
        state.stats.notRecorded++
        this.vitest.logger.log(`[incremental] not caching ${test}: cache write failed`)
        continue
      }
      state.stats.recorded++
    }
    const recordMs = Math.round(performance.now() - recordStart)
    const summaries = [...this.projects.values()].map((state) => {
      const { stats } = state
      if (this.mode !== 'plan') {
        for (const test of stats.executedFiles) {
          if (!reported.has(test)) stats.failedFiles.push(`${test} (no result reported)`)
        }
      }
      mkdirSync(state.workDir, { recursive: true })
      writeFileSync(join(state.workDir, 'decisions.log'), stats.decisions.join('\n') + '\n')
      const { decisions: _decisions, validationMs, ...counts } = stats
      this.vitest.logger.log(
        `[incremental] ${state.name}: ${stats.testFiles} files, ${stats.reused} reused, ` +
          `${stats.executedFiles.length} ${this.mode === 'plan' ? 'would run' : 'run'}, ` +
          `${stats.recorded} recorded (decisions: ${join(state.workDir, 'decisions.log')})`,
      )
      return {
        project: state.name,
        globalKey: state.globalKey,
        mode: this.mode,
        ...counts,
        executed: stats.executedFiles.length,
        timings: {
          validationMs: Math.round(validationMs),
          recordMs,
          totalMs: Date.now() - this.runStart,
        },
      }
    })
    const summaryFile = this.options.summaryFile ?? process.env.VITEST_INCREMENTAL_SUMMARY
    if (summaryFile) {
      writeFileSync(
        summaryFile,
        JSON.stringify(summaries.length === 1 ? summaries[0] : summaries, null, 2),
      )
    }
  }
}
