import { createHash } from 'node:crypto'
import {
  type Dirent,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  type Stats,
  statSync,
} from 'node:fs'
import { join } from 'node:path'

/**
 * A dependency key is `<kind>:<repo-relative path>`:
 *  - `f:` file contents (modules, successful fs.readFile/open targets)
 *  - `d:` directory listing: entry names and types (fs.readdir/opendir targets)
 *  - `r:` recursive listing: every relative path and type in the subtree,
 *         skipping `node_modules` and `.git` (readdir/opendir with `recursive`)
 *  - `s:` existence/type only (fs.exists/access targets, failed reads)
 *  - `m:` stat metadata: type, size of files, permission bits (fs.stat targets)
 *  - `l:` lstat metadata: as `m:` without following symlinks; a symlink hashes
 *         to its target string (fs.lstat targets)
 * Missing paths hash to `missing`, so a file appearing or disappearing is a
 * change. Timestamps, inode and device numbers are never hashed, so a cache
 * stays valid across machines and fresh checkouts. Every kind except `s:` is
 * recorded only after the test observed the path existing.
 */
export type DependencyKind = 'f' | 'd' | 'r' | 's' | 'm' | 'l'
export type DependencyKey = `${DependencyKind}:${string}`

/**
 * Recorded in a test's env keys when it enumerated `process.env` (Object.keys,
 * spread, for-in): its env digest then also covers the set of variable names.
 * Not a valid variable name, so it cannot collide with a real read.
 */
export const ENV_NAMES_MARKER = '\u0000names'

/**
 * Terminal-session and per-invocation identifiers that differ on every shell or
 * CI run but carry no test semantics; code that spreads process.env reads them
 * all. Everything else that is read (including PATH, HOME, GITHUB_SHA and
 * GITHUB_REF) becomes part of the fingerprint.
 */
export const SESSION_ONLY_ENV =
  /^(_|PWD|OLDPWD|SHLVL|TERM|TERM_PROGRAM(_VERSION)?|TERM_SESSION_ID|COLORTERM|TMUX|TMUX_PANE|STY|WINDOWID|COLUMNS|LINES|LS_COLORS|SSH_\w+|INVOCATION_ID|JOURNAL_STREAM|SYSTEMD_EXEC_PID|SUDO_COMMAND|BUN_TEST_INCREMENTAL\w*|GITHUB_\w+|ACTIONS_\w+|RUNNER_\w+)$/

const SKIPPED_IN_TREES = new Set(['node_modules', '.git'])

export function sha256(data: string | Buffer, length = 16) {
  return createHash('sha256').update(data).digest('hex').slice(0, length)
}

function statType(stat: Stats | Dirent) {
  if (stat.isSymbolicLink()) return 'symlink'
  if (stat.isFile()) return 'file'
  if (stat.isDirectory()) return 'dir'
  return 'other'
}

function statKind(absolute: string) {
  try {
    return statType(statSync(absolute))
  } catch {
    return 'missing'
  }
}

/** Content-derived metadata only: no timestamps, inode or device numbers. */
function metadata(absolute: string, follow: boolean) {
  let stat: Stats
  try {
    stat = follow ? statSync(absolute) : lstatSync(absolute)
  } catch {
    return 'missing'
  }
  const type = statType(stat)
  const mode = (stat.mode & 0o7777).toString(8)
  if (type === 'symlink') return `symlink:${readlinkSync(absolute)}`
  if (type === 'file') return `file:${stat.size}:${mode}`
  return `${type}:${mode}`
}

function listing(absolute: string) {
  return readdirSync(absolute, { withFileTypes: true })
    .map((entry) => `${entry.name}\t${statType(entry)}`)
    .sort()
}

/** Relative path and type of every entry below `absolute`; does not follow symlinks. */
function tree(absolute: string, prefix = ''): string[] {
  const lines: string[] = []
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (SKIPPED_IN_TREES.has(entry.name)) continue
    const rel = prefix + entry.name
    const type = statType(entry)
    lines.push(`${rel}\t${type}`)
    if (type === 'dir') lines.push(...tree(join(absolute, entry.name), `${rel}/`))
  }
  return lines
}

function errorCode(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  return typeof code === 'string' ? code : 'error'
}

/** Content hasher with a per-instance memo; create a new one to observe new contents. */
export class Hasher {
  private memo = new Map<string, string>()
  hashedFiles = 0
  hashedBytes = 0

  constructor(private readonly repoRoot: string) {}

  /** Never throws: an input that cannot be read (EACCES, a race) hashes to `unreadable:<code>`. */
  hash(key: DependencyKey): string {
    const cached = this.memo.get(key)
    if (cached !== undefined) return cached
    let value: string
    try {
      value = this.compute(key)
    } catch (error) {
      value = `unreadable:${errorCode(error)}`
    }
    this.memo.set(key, value)
    return value
  }

  private compute(key: DependencyKey): string {
    const kind = key[0]
    const absolute = join(this.repoRoot, key.slice(2))
    if (kind === 'm' || kind === 'l') return metadata(absolute, kind === 'm')
    const type = statKind(absolute)
    if (kind === 's' || type === 'missing') return type
    if (kind === 'd' || kind === 'r') {
      if (type !== 'dir') return type
      return sha256((kind === 'd' ? listing(absolute) : tree(absolute).sort()).join('\n'))
    }
    if (type !== 'file') return type
    const content = readFileSync(absolute)
    this.hashedFiles++
    this.hashedBytes += content.length
    return sha256(content)
  }
}

/**
 * One digest over the named variables, so no per-variable hash of a secret is
 * stored. With ENV_NAMES_MARKER among the keys it also covers the sorted set of
 * variable names present (minus session-only ones), for tests that enumerate
 * process.env.
 */
export function envDigest(keys: readonly string[], env: NodeJS.ProcessEnv) {
  const unique = [...new Set(keys)].sort()
  const parts = unique
    .filter((key) => key !== ENV_NAMES_MARKER)
    .map((key) => {
      const value = env[key]
      return `${key}=${value === undefined ? '\u0000unset' : sha256(value, 64)}`
    })
  if (unique.includes(ENV_NAMES_MARKER)) {
    const names = Object.keys(env)
      .filter((name) => env[name] !== undefined && !SESSION_ONLY_ENV.test(name))
      .sort()
    parts.push(`${ENV_NAMES_MARKER}=${sha256(names.join('\n'), 64)}`)
  }
  return sha256(parts.join('\n'))
}
