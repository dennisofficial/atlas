import { statSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import type { TestModule } from 'vitest/node'
import { type DependencyKey, type DependencyKind, envDigest, Hasher } from './fingerprint'
import type { CacheEntry } from './store'
import type { RecordedInputs } from './types'

export function modulePassed(testModule: TestModule) {
  if (testModule.state() !== 'passed' || testModule.errors().length > 0) return false
  for (const test of testModule.children.allTests()) {
    if (test.result().state === 'failed') return false
  }
  return true
}

/** Repo-relative dependency keys for what a test file recorded, or why there are none. */
export function dependencyKeys(params: {
  moduleId: string
  recorded: RecordedInputs | undefined
  repoRoot: string
}): DependencyKey[] | string {
  const { moduleId, recorded, repoRoot } = params
  if (!recorded?.recorderOk) return 'no dependency record'
  if (recorded.uncacheable) return recorded.uncacheable
  const keys = new Set<DependencyKey>()
  const toRelative = (raw: string) => {
    const path = raw.replace(/[?#].*$/, '')
    if (!isAbsolute(path) || path.includes('/node_modules/')) return undefined
    const rel = relative(repoRoot, path)
    return rel.startsWith('..') ? undefined : rel
  }
  for (const id of [moduleId, ...recorded.modules, ...recorded.files]) {
    // `mock:<path>` is a module replaced by vi.mock. Automocks and vi.importActual
    // load the original under its real path, so only its existence matters here.
    const isMock = id.startsWith('mock:')
    const rel = toRelative(isMock ? id.slice(5) : id)
    if (rel) keys.add(isMock ? `s:${rel}` : `f:${rel}`)
  }
  const lists: Array<[DependencyKind, string[] | undefined]> = [
    ['d', recorded.dirs],
    ['r', recorded.trees],
    ['s', recorded.stats],
    ['m', recorded.statInfo],
    ['l', recorded.lstatInfo],
  ]
  for (const [kind, ids] of lists) {
    for (const id of ids ?? []) {
      const rel = toRelative(id)
      if (rel) keys.add(`${kind}:${rel}`)
    }
  }
  return [...keys].sort()
}

/** Builds the cache entry for a passing module, or returns why it is not cacheable. */
export function buildEntry(params: {
  testModule: TestModule
  repoRoot: string
  runStart: number
  hasher: Hasher
}): CacheEntry | string {
  const { testModule, repoRoot, runStart, hasher } = params
  // A pass on retry is a flaky pass; caching it would hide the next failure.
  if ([...testModule.children.allTests()].some((test) => test.diagnostic()?.flaky)) {
    return 'a test passed only on retry'
  }
  const recorded = testModule.meta().incremental
  const keys = dependencyKeys({ moduleId: testModule.moduleId, recorded, repoRoot })
  if (typeof keys === 'string') return keys
  if (keys.some((key) => modifiedSince(join(repoRoot, key.slice(2)), runStart))) {
    return 'an input changed during the run'
  }
  const deps = Object.fromEntries(keys.map((key) => [key, hasher.hash(key)])) as Record<
    DependencyKey,
    string
  >
  // Every kind but `s:` was recorded only after the test saw the path existing,
  // so `missing` now means it was deleted while the test ran (no mtime to see).
  if (keys.some((key) => !key.startsWith('s:') && deps[key] === 'missing')) {
    return 'an input changed during the run'
  }
  const envKeys = [...new Set(recorded?.env ?? [])].sort()
  const diagnostic = testModule.diagnostic()
  return {
    deps,
    envKeys,
    envDigest: envDigest(envKeys, process.env),
    passedAt: new Date().toISOString(),
    durationMs: Math.round(
      diagnostic.environmentSetupDuration +
        diagnostic.prepareDuration +
        diagnostic.collectDuration +
        diagnostic.setupDuration +
        diagnostic.duration,
    ),
    tests: [...testModule.children.allTests()].length,
  }
}

function modifiedSince(path: string, since: number) {
  try {
    return statSync(path).mtimeMs > since
  } catch {
    return false
  }
}
