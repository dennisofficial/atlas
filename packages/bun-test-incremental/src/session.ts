import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { plugin } from 'bun'
import { afterAll } from 'bun:test'
import { installBunTestWrap, installTimerGuards } from './bun-test-wrap'
import { Hasher } from './fingerprint'
import { installRecorder } from './fs-env-recorder'
import { computeGlobalKey } from './global-key'
import { type IncrementalConfig } from './config'
import { loaderFor, traceImports } from './import-graph'
import { buildEntry } from './record'
import { countMiss, emptyStats, report } from './stats'
import { ResultStore } from './store'
import { isTracking, untracked } from './tracking'
import { EMode, FileRecord } from './types'

// mock.module('bun:test') rebinds this module's live `afterAll` import to the instrumented one; capturing it now keeps the real hook.
const registerAfterAll = afterAll
const PLUGIN_DIR = join(dirname(import.meta.dir))
const EVALUATED = Symbol.for('@dltech/bun-test-incremental/evaluated')
const SPEC = /[._](test|spec)\.[cm]?[jt]sx?$/
const PARTIAL_RUN = /^(-t|--test-name-pattern|--only)(=|$)/

const stub = (name: string) =>
  `import { test } from 'bun:test';\ntest.skip(${JSON.stringify(name)}, () => {});\n`

const epilogue = (path: string) =>
  `\n;globalThis[Symbol.for(${JSON.stringify(EVALUATED.description)})]?.(${JSON.stringify(path)});\n`

// Bun.argv omits bun's own flags (`-t`, `--only`), so the real command line comes from ps.
function commandLine() {
  const ps = Bun.spawnSync(['ps', '-o', 'args=', '-p', String(process.pid)])
  return ps.stdout.toString().trim().split(/\s+/)
}

function realPath(path: string) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function sharesImport(params: { left: FileRecord; right: FileRecord }) {
  const { left, right } = params
  const known = new Set(left.imports)
  return right.imports.some((path) => known.has(path))
}

export function startSession(config: IncrementalConfig) {
  const { repoRoot, projectRoot, cacheDir } = config
  if (config.mode === EMode.Clear) ResultStore.clear(cacheDir)
  ResultStore.claim(cacheDir)
  const mode = config.mode === EMode.Clear ? EMode.Force : config.mode
  const project = relative(repoRoot, projectRoot) || '.'
  const { key: globalKey } = computeGlobalKey({
    repoRoot,
    projectRoot,
    pluginDir: PLUGIN_DIR,
    globalInputs: config.globalInputs,
    env: config.env,
  })
  const slug = project.replace(/[^\w.-]+/g, '-')
  const store = new ResultStore(join(cacheDir, slug, globalKey))
  const workDir = join(cacheDir, 'work', slug)
  const partialRun = commandLine().some((arg) => PARTIAL_RUN.test(arg))
  const startedAt = Date.now()
  const stats = emptyStats()
  const records = new Map<string, FileRecord>()
  const realMain = new Map<string, string>()
  const lookupHasher = new Hasher(repoRoot)
  let baselineEnv: NodeJS.ProcessEnv | undefined
  const baseline = () => (baselineEnv ??= { ...realEnv })

  const mainPath = () => {
    const main = Bun.main
    let real = realMain.get(main)
    if (real === undefined) {
      real = realPath(main)
      realMain.set(main, real)
    }
    return real
  }
  const current = () => (isTracking() ? records.get(mainPath()) : undefined)
  const realEnv = installRecorder({ repoRoot, current })
  installBunTestWrap({ current })
  installTimerGuards({ current })

  const flushed = new Set<FileRecord>()
  const flush = (record: FileRecord) => {
    if (flushed.has(record)) return
    flushed.add(record)
    const test = relative(repoRoot, record.absolute)
    record.settlePending()
    const unsettled = record.opened !== record.settled
    const failure = record.failure ?? (unsettled ? 'a test or hook never settled' : undefined)
    if (failure !== undefined) {
      stats.failedFiles.push(test)
      return
    }
    if (partialRun) return
    const entry = buildEntry({
      file: record,
      repoRoot,
      hasher: new Hasher(repoRoot),
      env: baseline(),
    })
    if (typeof entry === 'string') {
      stats.notRecorded++
      const spawned = record.spawned.slice(0, 3).join(' | ')
      console.log(`[incremental] not caching ${test}: ${entry}${spawned ? ` (${spawned})` : ''}`)
      return
    }
    if (store.write(test, entry)) stats.recorded++
    else {
      stats.notRecorded++
      console.log(`[incremental] not caching ${test}: cache write failed`)
    }
  }

  const decide = (test: string) => {
    if (mode === EMode.Force) return { status: 'miss' as const, reason: 'forced' }
    return store.lookup(test, lookupHasher, baseline())
  }

  const load = (path: string) => {
    const test = relative(repoRoot, path)
    const lookup = decide(test)
    stats.testFiles++
    if (lookup.status === 'hit') {
      stats.reused++
      stats.decisions.push(`skip ${test} (passed ${lookup.entry.passedAt})`)
    } else {
      stats.executedFiles.push(test)
      stats.decisions.push(`run  ${test} (${lookup.reason})`)
      countMiss({ stats, reason: lookup.reason })
    }
    if (mode === EMode.Plan) {
      console.log(stats.decisions[stats.decisions.length - 1])
      return { contents: stub(`plan: ${test} not run`), loader: 'js' as const }
    }
    if (lookup.status === 'hit') {
      return {
        contents: stub(`reused: ${test} passed with unchanged inputs`),
        loader: 'js' as const,
      }
    }
    const imports = traceImports({ entry: path, repoRoot })
    const record = new FileRecord(path, imports)
    for (const earlier of records.values()) {
      if (sharesImport({ left: earlier, right: record })) record.inheritLoadPhase(earlier)
    }
    records.set(path, record)
    const source = readFileSync(path, 'utf8')
    return { contents: source + epilogue(path), loader: loaderFor(path) }
  }

  ;(globalThis as Record<symbol, unknown>)[EVALUATED] = (path: string) => {
    const record = records.get(realPath(path))
    if (record) record.evaluated = true
  }

  plugin({
    name: 'bun-test-incremental',
    setup(build) {
      build.onLoad({ filter: SPEC }, (args) =>
        untracked(() => {
          const path = realPath(args.path)
          if (path !== mainPath())
            return { contents: readFileSync(args.path, 'utf8'), loader: loaderFor(args.path) }
          for (const record of records.values()) flush(record)
          return load(path)
        }),
      )
    },
  })

  registerAfterAll(() => {
    untracked(() => {
      for (const record of records.values()) flush(record)
      if (mode !== EMode.Plan) {
        for (const test of stats.executedFiles) {
          const ran = [...records.keys()].some((path) => relative(repoRoot, path) === test)
          if (!ran) stats.failedFiles.push(`${test} (no result reported)`)
        }
      }
      report({
        stats,
        mode,
        project,
        globalKey,
        workDir,
        summaryFile: config.summaryFile,
        startedAt,
      })
    })
  })
}
