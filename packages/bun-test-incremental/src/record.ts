import { isAbsolute, relative } from 'node:path'
import { type DependencyKey, type DependencyKind, envDigest, type Hasher } from './fingerprint'
import type { CacheEntry } from './store'
import { EPathSink, type FileRecord, type PendingOp } from './types'

const KIND_BY_SINK: Record<EPathSink, DependencyKind> = {
  [EPathSink.Files]: 'f',
  [EPathSink.Dirs]: 'd',
  [EPathSink.Trees]: 'r',
  [EPathSink.Stats]: 's',
  [EPathSink.StatInfo]: 'm',
  [EPathSink.LstatInfo]: 'l',
}

export function dependencyKey(params: {
  path: string
  sink: EPathSink
  repoRoot: string
}): DependencyKey | undefined {
  const { path, sink, repoRoot } = params
  if (!isAbsolute(path) || path.includes('/node_modules/')) return undefined
  const rel = relative(repoRoot, path)
  return rel.startsWith('..') ? undefined : `${KIND_BY_SINK[sink]}:${rel}`
}

export function dependencyKeys(params: { file: FileRecord; repoRoot: string }): DependencyKey[] {
  const { file, repoRoot } = params
  const keys = new Set<DependencyKey>()
  const add = (path: string, sink: EPathSink) => {
    const key = dependencyKey({ path, sink, repoRoot })
    if (key) keys.add(key)
  }
  for (const path of [file.absolute, ...file.imports]) add(path, EPathSink.Files)
  for (const sink of Object.values(EPathSink)) {
    for (const path of file.paths[sink]) add(path, sink)
  }
  return [...keys].sort()
}

export function readKeys(params: { op: PendingOp; repoRoot: string }): DependencyKey[] {
  const { op, repoRoot } = params
  return [op.sink, EPathSink.Stats]
    .map((sink) => dependencyKey({ path: op.path, sink, repoRoot }))
    .filter((key): key is DependencyKey => key !== undefined)
}

export function snapshotInputs(params: {
  file: FileRecord
  keys: DependencyKey[]
  hasher: Hasher
}) {
  const { file, keys, hasher } = params
  for (const key of keys) {
    if (!file.inputHashes.has(key)) file.inputHashes.set(key, hasher.hash(key))
  }
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
  const changedDuring = keys.some((key) => {
    const atLoad = file.inputHashes.get(key)
    return atLoad !== undefined && atLoad !== hasher.hash(key)
  })
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
