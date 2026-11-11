import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'

import ignore, { type Ignore } from 'ignore'

import {
  isHardExcluded,
  selectedByPolicy,
  selectionPolicyOf,
  type SelectionPolicy,
} from '../selection'
import { parseSpec, SPEC_FILE_NAME, type ArtifactSpec } from '../spec'

const TOKEN_LENGTH = 8

const GITIGNORE_FILE_NAME = '.gitignore'

const GIT_LISTING_ARGS: readonly string[] = [
  'ls-files',
  '--cached',
  '--others',
  '--exclude-standard',
  '-z',
]

export type WalkedFile = { path: string; absolute: string; size: number }

export type WalkTreeArgs = { root: string; filter?: (path: string) => boolean }

export function randomToken(bytes: Uint8Array): string {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  const digits = value.toString(36)
  return digits.length >= TOKEN_LENGTH
    ? digits.slice(-TOKEN_LENGTH)
    : digits.padStart(TOKEN_LENGTH, '0')
}

export async function hashFile(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256')
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk)
  return hasher.digest('hex')
}

async function* walkDirectory(args: {
  root: string
  directory: string
  filter: ((path: string) => boolean) | undefined
}): AsyncIterable<WalkedFile> {
  const absoluteDirectory = args.directory === '' ? args.root : join(args.root, args.directory)
  const entries = await readdir(absoluteDirectory, { withFileTypes: true })
  for (const entry of entries) {
    const path = args.directory === '' ? entry.name : `${args.directory}/${entry.name}`
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (isHardExcluded({ path: `${path}/` })) continue
      yield* walkDirectory({ root: args.root, directory: path, filter: args.filter })
      continue
    }
    if (!entry.isFile()) continue
    if (args.filter !== undefined && !args.filter(path)) continue
    const absolute = join(args.root, path)
    const info = await lstat(absolute)
    yield { path, absolute, size: info.size }
  }
}

export async function* walkTree({ root, filter }: WalkTreeArgs): AsyncIterable<WalkedFile> {
  yield* walkDirectory({ root, directory: '', filter })
}

const gitListedPaths = async ({ dir }: { dir: string }): Promise<string[] | null> => {
  const proc = Bun.spawn(['git', '-C', dir, ...GIT_LISTING_ARGS], {
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const listing = await new Response(proc.stdout).text()
  if ((await proc.exited) !== 0) return null
  return listing.split('\0').filter((path) => path.length > 0)
}

const rebaseIgnorePattern = ({
  pattern,
  directory,
}: {
  pattern: string
  directory: string
}): string => {
  const trimmed = pattern.trim()
  if (trimmed.length === 0 || trimmed.startsWith('#')) return ''
  if (directory === '') return trimmed
  const negated = trimmed.startsWith('!')
  const body = (negated ? trimmed.slice(1) : trimmed).replace(/^\/+/, '')
  return `${negated ? '!' : ''}${directory}/${body}`
}

const collectIgnorePatterns = async ({
  root,
  directory,
}: {
  root: string
  directory: string
}): Promise<string[]> => {
  const entries = await readdir(directory === '' ? root : join(root, directory), {
    withFileTypes: true,
  })
  const patterns: string[] = []
  for (const entry of entries) {
    const path = directory === '' ? entry.name : `${directory}/${entry.name}`
    if (entry.isDirectory()) {
      if (isHardExcluded({ path: `${path}/` })) continue
      patterns.push(...(await collectIgnorePatterns({ root, directory: path })))
      continue
    }
    if (entry.name !== GITIGNORE_FILE_NAME || !entry.isFile()) continue
    const text = await readFile(join(root, path), 'utf8')
    for (const line of text.split('\n')) {
      patterns.push(rebaseIgnorePattern({ pattern: line, directory }))
    }
  }
  return patterns.filter((pattern) => pattern.length > 0)
}

const ignoredMatcherOf = async ({ dir }: { dir: string }): Promise<Ignore> =>
  ignore().add(await collectIgnorePatterns({ root: dir, directory: '' }))

const fallbackPaths = async ({ dir }: { dir: string }): Promise<string[]> => {
  const matcher = await ignoredMatcherOf({ dir })
  const paths: string[] = []
  for await (const file of walkTree({ root: dir, filter: (path) => !matcher.ignores(path) })) {
    paths.push(file.path)
  }
  return paths
}

const forcedIncludePaths = async ({
  dir,
  policy,
  known,
}: {
  dir: string
  policy: SelectionPolicy
  known: ReadonlySet<string>
}): Promise<string[]> => {
  const paths: string[] = []
  for await (const file of walkTree({
    root: dir,
    filter: (path) => !policy.hardExcluded(path),
  })) {
    if (known.has(file.path)) continue
    if (!policy.forceIncluded(file.path)) continue
    paths.push(file.path)
  }
  return paths
}

const existsInside = async ({ dir, path }: { dir: string; path: string }): Promise<boolean> => {
  try {
    const info = await lstat(join(dir, path))
    if (info.isFile()) return true
    if (!info.isSymbolicLink()) return false
    const root = await realpath(dir)
    const resolved = await realpath(join(dir, path))
    if (!resolved.startsWith(`${root}${sep}`)) return false
    return (await lstat(resolved)).isFile()
  } catch {
    return false
  }
}

const loadSpec = async ({ dir }: { dir: string }): Promise<ArtifactSpec> => {
  const file = Bun.file(join(dir, SPEC_FILE_NAME))
  if (!(await file.exists())) return parseSpec({})
  return parseSpec(await file.json())
}

export async function selectFiles({ dir }: { dir: string }): Promise<string[]> {
  const spec = await loadSpec({ dir })
  const policy = selectionPolicyOf(spec)
  const listed = await gitListedPaths({ dir })
  const candidates = new Set<string>(listed ?? (await fallbackPaths({ dir })))
  if (spec.publish.include.length > 0) {
    for (const path of await forcedIncludePaths({ dir, policy, known: candidates })) {
      candidates.add(path)
    }
  }
  const selected: string[] = []
  for (const path of candidates) {
    if (!(await existsInside({ dir, path }))) continue
    if (selectedByPolicy({ path, policy, fromGit: true })) selected.push(path)
  }
  return selected.sort()
}
