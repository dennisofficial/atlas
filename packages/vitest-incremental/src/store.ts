import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { type DependencyKey, envDigest, type Hasher, sha256 } from './fingerprint'

/**
 * Layout: <cacheRoot>/<project>/<globalKey>/<sha256(test path)>.json
 *
 * Only successful, complete runs are written. Each file keeps the newest
 * MAX_ENTRIES passing records of one test file, so results from several
 * branches or PR revisions can coexist. A global input change moves to a new
 * <globalKey> directory instead of rewriting anything.
 */
export const SCHEMA = 1
const MAX_ENTRIES = 4

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
  entries: CacheEntry[]
}

export type Lookup = { status: 'hit'; entry: CacheEntry } | { status: 'miss'; reason: string }

export class ResultStore {
  constructor(readonly directory: string) {}

  private pathFor(test: string) {
    return join(this.directory, `${sha256(test, 24)}.json`)
  }

  private read(test: string): CacheFile | 'missing' | 'corrupt' {
    let raw: string
    try {
      raw = readFileSync(this.pathFor(test), 'utf8')
    } catch {
      return 'missing'
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      return isCacheFile(parsed, test) ? parsed : 'corrupt'
    } catch {
      return 'corrupt'
    }
  }

  lookup(test: string, hasher: Hasher, env: NodeJS.ProcessEnv): Lookup {
    const file = this.read(test)
    if (file === 'missing') return { status: 'miss', reason: 'no cached result' }
    if (file === 'corrupt') return { status: 'miss', reason: 'corrupt cache entry' }
    if (file.entries.length === 0) return { status: 'miss', reason: 'no cached result' }

    // Report the most specific reason: a record whose files all match but whose
    // env differs explains the miss better than the newest record's first file.
    let reason: string | undefined
    try {
      for (const entry of file.entries) {
        const changed = firstChangedInput(entry, hasher, env)
        if (!changed) return { status: 'hit', entry }
        if (!reason || changed.startsWith('env')) reason = changed
      }
    } catch (error) {
      return { status: 'miss', reason: `cache validation error: ${errorMessage(error)}` }
    }
    return { status: 'miss', reason: `changed: ${reason}` }
  }

  /**
   * Best-effort atomic write (tmp + rename). Never throws: a cache that cannot
   * be written only costs a rerun later. Returns whether the record was stored.
   */
  write(test: string, entry: CacheEntry): boolean {
    const target = this.pathFor(test)
    const temporary = `${target}.${process.pid}.tmp`
    try {
      const existing = this.read(test)
      const previous = typeof existing === 'object' ? existing.entries : []
      const sameInputs = (other: CacheEntry) =>
        other.envDigest === entry.envDigest &&
        JSON.stringify(other.deps) === JSON.stringify(entry.deps)
      const entries = [entry, ...previous.filter((e) => !sameInputs(e))].slice(0, MAX_ENTRIES)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(
        temporary,
        JSON.stringify({ schema: SCHEMA, test, entries } satisfies CacheFile),
      )
      renameSync(temporary, target)
      return true
    } catch {
      try {
        rmSync(temporary, { force: true })
      } catch {
        // Nothing left to clean up, or cleanup is impossible too; stay silent.
      }
      return false
    }
  }

  size() {
    try {
      return readdirSync(this.directory).filter((name) => name.endsWith('.json')).length
    } catch {
      return 0
    }
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
        `[incremental] Refusing to clear ${cacheRoot}: it has no ${TAG_FILE} written by vitest-incremental, ` +
          'so it may hold other files. Check cacheDir, or delete the directory yourself.',
      )
    }
    rmSync(cacheRoot, { recursive: true, force: true })
  }
}

const TAG_FILE = 'CACHEDIR.TAG'
// The standard cache directory tag (https://bford.info/cachedir/) plus our name.
const TAG =
  'Signature: 8a477f597d28d172789f06886806bc55\n# Created by @dltech/vitest-incremental.\n'

function firstChangedInput(entry: CacheEntry, hasher: Hasher, env: NodeJS.ProcessEnv) {
  for (const [key, hash] of Object.entries(entry.deps)) {
    if (hasher.hash(key as DependencyKey) !== hash) return key
  }
  if (envDigest(entry.envKeys, env) !== entry.envDigest) {
    return `env (one of ${entry.envKeys.length} variables read by the test)`
  }
  return undefined
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
    isRecord(value) &&
    value.schema === SCHEMA &&
    value.test === test &&
    Array.isArray(value.entries) &&
    value.entries.every(isCacheEntry)
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
