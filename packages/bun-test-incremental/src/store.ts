import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { type DependencyKey, envDigest, type Hasher, sha256 } from './fingerprint'

/**
 * Layout: <cacheRoot>/<project>/<globalKey>/<sha256(test path)>.<sha256(record)>.json
 *
 * One passing record per file, named by its content, so every copy of a name
 * holds the same bytes. CI restores eight shard caches into one directory, and
 * each later archive replaces the files an earlier one holds; a name per record
 * means no archive can replace a newer record with its stale copy. A write
 * keeps the newest MAX_ENTRIES records of its test file, so results from
 * several branches or PR revisions coexist. A global input change moves to a
 * new <globalKey> directory instead of rewriting anything.
 */
export const SCHEMA = 2
const MAX_ENTRIES = 4
const STEM_LENGTH = 24

export interface CacheEntry {
  /** Dependency key -> content hash at the time the test passed. */
  deps: Record<DependencyKey, string>
  envKeys: string[]
  envDigest: string
  passedAt: string
  durationMs: number
  tests: number
}

interface CacheFile {
  schema: number
  test: string
  entry: CacheEntry
}

type StoredEntry = { name: string; entry: CacheEntry }

export type Lookup = { status: 'hit'; entry: CacheEntry } | { status: 'miss'; reason: string }

export class ResultStore {
  private index: Map<string, string[]> | undefined

  constructor(readonly directory: string) {}

  private namesOf(test: string) {
    this.index ??= indexByTest(this.directory)
    return this.index.get(stemOf(test)) ?? []
  }

  private readAll(test: string) {
    const stored: StoredEntry[] = []
    let corrupt = false
    for (const name of this.namesOf(test)) {
      const file = readCacheFile({ path: join(this.directory, name), test })
      if (file === 'missing') continue
      if (file === 'corrupt') corrupt = true
      else stored.push({ name, entry: file.entry })
    }
    stored.sort((left, right) => right.entry.passedAt.localeCompare(left.entry.passedAt))
    return { stored, corrupt }
  }

  lookup(test: string, hasher: Hasher, env: NodeJS.ProcessEnv): Lookup {
    const { stored, corrupt } = this.readAll(test)
    if (stored.length === 0) {
      return { status: 'miss', reason: corrupt ? 'corrupt cache entry' : 'no cached result' }
    }

    // Report the most specific reason: a record whose files all match but whose
    // env differs explains the miss better than the newest record's first file.
    let closest: { changed: string; entry: CacheEntry } | undefined
    try {
      for (const { entry } of stored) {
        const changed = firstChangedInput(entry, hasher, env)
        if (!changed) return { status: 'hit', entry }
        if (!closest || changed.startsWith('env')) closest = { changed, entry }
      }
    } catch (error) {
      return { status: 'miss', reason: `cache validation error: ${errorMessage(error)}` }
    }
    if (!closest) return { status: 'miss', reason: 'no cached result' }
    return {
      status: 'miss',
      reason: `changed: ${closest.changed}, since the pass of ${closest.entry.passedAt}`,
    }
  }

  /**
   * Best-effort atomic write (tmp + rename). Never throws: a cache that cannot
   * be written only costs a rerun later. Returns whether the record was stored.
   */
  write(test: string, entry: CacheEntry): boolean {
    const name = `${stemOf(test)}.${sha256(JSON.stringify(entry))}.json`
    const target = join(this.directory, name)
    const temporary = `${target}.${process.pid}.tmp`
    try {
      const { stored } = this.readAll(test)
      mkdirSync(this.directory, { recursive: true })
      writeFileSync(temporary, JSON.stringify({ schema: SCHEMA, test, entry } satisfies CacheFile))
      renameSync(temporary, target)
      const sameInputs = (other: CacheEntry) =>
        other.envDigest === entry.envDigest &&
        JSON.stringify(other.deps) === JSON.stringify(entry.deps)
      const older = stored.filter((record) => record.name !== name)
      const kept = older.filter((record) => !sameInputs(record.entry)).slice(0, MAX_ENTRIES - 1)
      for (const record of older) {
        if (!kept.includes(record)) removeQuietly(join(this.directory, record.name))
      }
      this.index?.set(stemOf(test), [name, ...kept.map((record) => record.name)])
      return true
    } catch {
      removeQuietly(temporary)
      return false
    }
  }

  /** The number of test files with at least one stored record. */
  size() {
    return indexByTest(this.directory).size
  }

  /** Tags a new or empty cache root as ours, so `clear` may delete it later. Best-effort. */
  static claim(cacheRoot: string) {
    try {
      mkdirSync(cacheRoot, { recursive: true })
      if (readdirSync(cacheRoot).length === 0) writeFileSync(join(cacheRoot, TAG_FILE), TAG)
    } catch {
      // An unwritable cache only costs reruns.
    }
  }

  /** Deletes the cache root, but only one `claim` tagged: a mistyped cacheDir must not cost a checkout. */
  static clear(cacheRoot: string) {
    if (!existsSync(cacheRoot)) return
    let tag = ''
    try {
      tag = readFileSync(join(cacheRoot, TAG_FILE), 'utf8')
    } catch {
      // Untagged: handled below.
    }
    if (tag !== TAG) {
      // An empty directory holds nothing to lose or delete; `claim` tags it next.
      if (readdirSync(cacheRoot).length === 0) return
      throw new Error(
        `[incremental] Refusing to clear ${cacheRoot}: it has no ${TAG_FILE} written by bun-test-incremental, ` +
          'so it may hold other files. Check cacheDir, or delete the directory yourself.',
      )
    }
    rmSync(cacheRoot, { recursive: true, force: true })
  }
}

const TAG_FILE = 'CACHEDIR.TAG'
// The standard cache directory tag (https://bford.info/cachedir/) plus our name.
const TAG =
  'Signature: 8a477f597d28d172789f06886806bc55\n# Created by @dltech/bun-test-incremental.\n'

function firstChangedInput(entry: CacheEntry, hasher: Hasher, env: NodeJS.ProcessEnv) {
  for (const [key, hash] of Object.entries(entry.deps)) {
    if (hasher.hash(key as DependencyKey) !== hash) return key
  }
  if (envDigest(entry.envKeys, env) !== entry.envDigest) {
    return `env (one of ${entry.envKeys.length} variables read by the test)`
  }
  return undefined
}

const stemOf = (test: string) => sha256(test, STEM_LENGTH)

function indexByTest(directory: string) {
  const index = new Map<string, string[]>()
  let names: string[]
  try {
    names = readdirSync(directory)
  } catch {
    return index
  }
  for (const name of names) {
    if (!name.endsWith('.json') || name[STEM_LENGTH] !== '.') continue
    const stem = name.slice(0, STEM_LENGTH)
    index.set(stem, [...(index.get(stem) ?? []), name])
  }
  return index
}

function readCacheFile(params: { path: string; test: string }): CacheFile | 'missing' | 'corrupt' {
  let raw: string
  try {
    raw = readFileSync(params.path, 'utf8')
  } catch {
    return 'missing'
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return isCacheFile(parsed, params.test) ? parsed : 'corrupt'
  } catch {
    return 'corrupt'
  }
}

function removeQuietly(path: string) {
  try {
    rmSync(path, { force: true })
  } catch {
    // An unremovable file only costs disk; a later write prunes it again.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** Dependency key kinds are not restricted here so new kinds stay readable. */
function isDependencyMap(value: unknown): value is Record<DependencyKey, string> {
  return isRecord(value) && Object.values(value).every((hash) => typeof hash === 'string')
}

function isCacheEntry(value: unknown): value is CacheEntry {
  return (
    isRecord(value) &&
    isDependencyMap(value.deps) &&
    isStringArray(value.envKeys) &&
    typeof value.envDigest === 'string' &&
    typeof value.passedAt === 'string' &&
    typeof value.durationMs === 'number' &&
    typeof value.tests === 'number'
  )
}

function isCacheFile(value: unknown, test: string): value is CacheFile {
  return (
    isRecord(value) && value.schema === SCHEMA && value.test === test && isCacheEntry(value.entry)
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
