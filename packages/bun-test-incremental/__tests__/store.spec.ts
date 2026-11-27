import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { envDigest, Hasher, sha256 } from '../src/fingerprint'
import { type CacheEntry, type Lookup, ResultStore, SCHEMA } from '../src/store'

const TEST_PATH = 'src/example.test.ts'
const ENV = { NODE_ENV: 'test' }
const CORRUPT: Lookup = { status: 'miss', reason: 'corrupt cache entry' }

let root: string
let storeDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bun-test-incremental-store-'))
  storeDir = join(root, 'store')
  writeFileSync(join(root, 'source.ts'), 'export const value = 1;\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function validEntry(): CacheEntry {
  return {
    deps: { 'f:source.ts': new Hasher(root).hash('f:source.ts') },
    envKeys: ['NODE_ENV'],
    envDigest: envDigest(['NODE_ENV'], ENV),
    passedAt: '2026-10-20T00:00:00.000Z',
    durationMs: 12,
    tests: 3,
  }
}

const STEM = sha256(TEST_PATH, 24)
const recordName = (entry: CacheEntry) => `${STEM}.${sha256(JSON.stringify(entry))}.json`

/** Writes a raw cache file where the store looks for the records of TEST_PATH. */
function writeRaw(content: string) {
  mkdirSync(storeDir, { recursive: true })
  writeFileSync(join(storeDir, `${STEM}.raw.json`), content)
}

function writeFile(overrides: { entry?: unknown; test?: string; schema?: number } = {}) {
  writeRaw(
    JSON.stringify({
      schema: overrides.schema ?? SCHEMA,
      test: overrides.test ?? TEST_PATH,
      entry: 'entry' in overrides ? overrides.entry : validEntry(),
    }),
  )
}

function filesOnDisk() {
  return new Map(readdirSync(storeDir).map((name) => [name, readFileSync(join(storeDir, name))]))
}

function entriesOnDisk() {
  const entries = [...filesOnDisk().values()].map(
    (raw) => (JSON.parse(raw.toString('utf8')) as { entry: CacheEntry }).entry,
  )
  return entries.sort((left, right) => right.passedAt.localeCompare(left.passedAt))
}

const passedAt = (minute: number) => `2026-10-20T00:${String(minute).padStart(2, '0')}:00.000Z`

function lookup() {
  return new ResultStore(storeDir).lookup(TEST_PATH, new Hasher(root), ENV)
}

describe('ResultStore.lookup', () => {
  test('hits a valid entry', () => {
    writeFile()
    expect(lookup()).toEqual({ status: 'hit', entry: validEntry() })
  })

  test('misses when there is no record', () => {
    expect(lookup()).toEqual({ status: 'miss', reason: 'no cached result' })
  })

  const corruptVariants: Array<[string, () => void]> = [
    ['invalid JSON', () => writeRaw('{ not json')],
    ['deps null', () => writeFile({ entry: { ...validEntry(), deps: null } })],
    // An empty array used to pass validation and match nothing -> false hit.
    ['deps array', () => writeFile({ entry: { ...validEntry(), deps: [] } })],
    [
      'non-string hash',
      () => writeFile({ entry: { ...validEntry(), deps: { 'f:source.ts': 42 } } }),
    ],
    ['missing envKeys', () => writeFile({ entry: { ...validEntry(), envKeys: undefined } })],
    ['non-array envKeys', () => writeFile({ entry: { ...validEntry(), envKeys: 'NODE_ENV' } })],
    ['non-string envKeys item', () => writeFile({ entry: { ...validEntry(), envKeys: [1] } })],
    ['non-string envDigest', () => writeFile({ entry: { ...validEntry(), envDigest: 7 } })],
    ['null entry', () => writeFile({ entry: null })],
    ['wrong test path', () => writeFile({ test: 'src/other.test.ts' })],
    ['wrong schema', () => writeFile({ schema: SCHEMA + 1 })],
  ]

  for (const [name, setup] of corruptVariants) {
    test(`treats ${name} as corrupt`, () => {
      setup()
      expect(lookup()).toEqual(CORRUPT)
    })
  }

  test('accepts dependency key kinds it does not know', () => {
    const entry = validEntry()
    writeFile({ entry: { ...entry, deps: { ...entry.deps, 'x:future': 'some-hash' } } })
    // Loaded and validated like any other key: its hash differs, so it is a normal miss.
    expect(lookup()).toEqual({
      status: 'miss',
      reason: `changed: x:future, since the pass of ${entry.passedAt}`,
    })
  })

  test('fails open when hashing throws', () => {
    writeFile()
    const hasher = new Hasher(root)
    hasher.hash = () => {
      throw new Error('boom')
    }
    expect(new ResultStore(storeDir).lookup(TEST_PATH, hasher, ENV)).toEqual({
      status: 'miss',
      reason: 'cache validation error: boom',
    })
  })
})

describe('ResultStore.write', () => {
  test('returns true, stores a readable record and leaves no temp files', () => {
    const store = new ResultStore(storeDir)
    expect(store.write(TEST_PATH, validEntry())).toBe(true)
    expect(readdirSync(storeDir).filter((name) => name.endsWith('.tmp'))).toEqual([])
    expect(lookup()).toEqual({ status: 'hit', entry: validEntry() })
  })

  test('returns false without throwing when the store directory is a file', () => {
    writeFileSync(storeDir, 'not a directory')
    const store = new ResultStore(storeDir)
    expect(() => store.write(TEST_PATH, validEntry())).not.toThrow()
    expect(store.write(TEST_PATH, validEntry())).toBe(false)
  })

  test('returns false and removes the temp file when the rename fails', () => {
    // The target path is a non-empty directory, so the rename cannot replace it.
    mkdirSync(join(storeDir, recordName(validEntry()), 'blocker'), { recursive: true })
    expect(new ResultStore(storeDir).write(TEST_PATH, validEntry())).toBe(false)
    expect(readdirSync(storeDir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  test('keeps the newest 4 records across runs, dropping older ones with identical inputs', () => {
    const base = validEntry()
    for (let i = 0; i < 6; i++) {
      const entry = { ...base, envDigest: `digest-${i}`, passedAt: passedAt(i) }
      expect(new ResultStore(storeDir).write(TEST_PATH, entry)).toBe(true)
    }
    const rerun = { ...base, envDigest: 'digest-4', passedAt: passedAt(6), tests: 99 }
    const store = new ResultStore(storeDir)
    expect(store.write(TEST_PATH, rerun)).toBe(true)
    expect(entriesOnDisk().map((e) => [e.envDigest, e.tests])).toEqual([
      ['digest-4', 99],
      ['digest-5', 3],
      ['digest-3', 3],
      ['digest-2', 3],
    ])
    expect(store.size()).toBe(1)
  })

  test('keeps a new record when a stale copy of the cache is restored over it', () => {
    const earlier = { ...validEntry(), envDigest: 'earlier-env', passedAt: passedAt(1) }
    new ResultStore(storeDir).write(TEST_PATH, earlier)
    const staleShardCache = filesOnDisk()
    const fresh = { ...validEntry(), passedAt: passedAt(2) }
    new ResultStore(storeDir).write(TEST_PATH, fresh)
    for (const [name, content] of staleShardCache) writeFileSync(join(storeDir, name), content)
    expect(lookup()).toEqual({ status: 'hit', entry: fresh })
  })
})

describe('clear', () => {
  test('treats an existing empty, untagged cache directory as nothing to clear', () => {
    const cacheRoot = join(root, 'cache')
    mkdirSync(cacheRoot)
    expect(() => ResultStore.clear(cacheRoot)).not.toThrow()
    ResultStore.claim(cacheRoot)
    expect(readdirSync(cacheRoot)).toEqual(['CACHEDIR.TAG'])
  })

  test('still refuses an untagged directory that holds files', () => {
    const cacheRoot = join(root, 'cache')
    mkdirSync(cacheRoot)
    writeFileSync(join(cacheRoot, 'keep.txt'), 'x')
    expect(() => ResultStore.clear(cacheRoot)).toThrow(/Refusing to clear/)
    expect(readdirSync(cacheRoot)).toEqual(['keep.txt'])
  })
})
