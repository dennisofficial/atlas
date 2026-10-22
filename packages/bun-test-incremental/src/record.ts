import { statSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { type DependencyKey, type DependencyKind, envDigest, type Hasher } from './fingerprint'
import type { CacheEntry } from './store'
import { EPathSink, type FileRecord } from './types'

const KIND_BY_SINK: Array<[EPathSink, DependencyKind]> = [
  [EPathSink.Dirs, 'd'],
  [EPathSink.Trees, 'r'],
  [EPathSink.Stats, 's'],
  [EPathSink.StatInfo, 'm'],
  [EPathSink.LstatInfo, 'l'],
]

function modifiedSince(params: { path: string; since: number }) {
  try {
    return statSync(params.path).mtimeMs > params.since
  } catch {
    return false
  }
}

export function dependencyKeys(params: { file: FileRecord; repoRoot: string }): DependencyKey[] {
  const { file, repoRoot } = params
  const keys = new Set<DependencyKey>()
  const toRelative = (path: string) => {
    if (!isAbsolute(path) || path.includes('/node_modules/')) return undefined
    const rel = relative(repoRoot, path)
    return rel.startsWith('..') ? undefined : rel
  }
  for (const path of [file.absolute, ...file.imports, ...file.paths[EPathSink.Files]]) {
    const rel = toRelative(path)
    if (rel) keys.add(`f:${rel}`)
  }
  for (const [sink, kind] of KIND_BY_SINK) {
    for (const path of file.paths[sink]) {
      const rel = toRelative(path)
      if (rel) keys.add(`${kind}:${rel}`)
    }
  }
  return [...keys].sort()
}

export function buildEntry(params: {
  file: FileRecord
  repoRoot: string
  hasher: Hasher
  env: NodeJS.ProcessEnv
}): CacheEntry | string {
  const { file, repoRoot, hasher, env } = params
  if (file.uncacheable) return file.uncacheable
  if (!file.evaluated) return 'the module did not finish evaluating'
  const keys = dependencyKeys({ file, repoRoot })
  const changedDuring = keys.some((key) =>
    modifiedSince({ path: join(repoRoot, key.slice(2)), since: file.loadedAt }),
  )
  if (changedDuring) return 'an input changed during the run'
  const deps = Object.fromEntries(keys.map((key) => [key, hasher.hash(key)])) as Record<
    DependencyKey,
    string
  >
  if (keys.some((key) => !key.startsWith('s:') && deps[key] === 'missing')) {
    return 'an input changed during the run'
  }
  const envKeys = [...file.env].sort()
  return {
    deps,
    envKeys,
    envDigest: envDigest(envKeys, env),
    passedAt: new Date().toISOString(),
    durationMs: Date.now() - file.loadedAt,
    tests: file.settled,
  }
}
