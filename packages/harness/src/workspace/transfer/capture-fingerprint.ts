import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { basename } from 'node:path'
import { join } from 'node:path'

import { captureGit } from './capture-git'
import { noIgnoreFilter, resolveIgnoreFilter } from './capture-ignore'
import { listCapturedWorktrees } from './capture-layout'
import {
  assertPortable,
  EEntryKind,
  hashFile,
  treeSkipRule,
  walkTree,
  type TreeEntry,
} from './capture-files'

const UNBORN = 'unborn'
const DETACHED = 'detached'

export type PointerMap = ReadonlyMap<string, string>

const POINTER_PREFIX = 'gitdir:'
const NESTED_GIT = '.git'
const escapePath = (path: string): string => path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function remapPaths({ text, mapping }: { text: string; mapping: PointerMap }): string {
  if (mapping.size === 0) return text
  const sources = [...mapping.keys()].sort((a, b) => b.length - a.length).map(escapePath)
  const pattern = new RegExp(`(?:${sources.join('|')})(?![A-Za-z0-9_.-])`, 'g')
  return text.replace(pattern, (match) => mapping.get(match) ?? match)
}

const hashPointer = async ({ path, mapping }: { path: string; mapping: PointerMap }): Promise<string | null> => {
  if (mapping.size === 0 || basename(path) !== NESTED_GIT) return null
  const text = (await readFile(path)).toString('utf8')
  if (!text.startsWith(POINTER_PREFIX)) return null
  return createHash('sha256').update(remapPaths({ text, mapping })).digest('hex')
}

const descriptorOf = async ({ root, entry, pointers }: { root: string; entry: TreeEntry; pointers: PointerMap }): Promise<string> => {
  const mode = entry.mode.toString(8)
  if (entry.kind === EEntryKind.Directory) return `dir\0${mode}\0${entry.path}`
  if (entry.kind === EEntryKind.Symlink) return `link\0${entry.path}\0${entry.target ?? ''}`
  const digest = (await hashPointer({ path: join(root, entry.path), mapping: pointers })) ?? (await hashFile(join(root, entry.path)))
  return `file\0${mode}\0${entry.path}\0${digest}`
}

const BATCH = 256

async function feedEntries({
  root,
  entries,
  hash,
  pointers,
}: {
  root: string
  entries: readonly TreeEntry[]
  hash: ReturnType<typeof createHash>
  pointers: PointerMap
}): Promise<void> {
  for (let start = 0; start < entries.length; start += BATCH) {
    const batch = entries.slice(start, start + BATCH)
    const lines = await Promise.all(batch.map((entry) => descriptorOf({ root, entry, pointers })))
    for (const line of lines) hash.update(`\n${line}`)
  }
}

type GitLogical = { head: string | null; branch: string | null; text: string }

const BRANCH_PREFIX = 'refs/heads/'

const gitLogicalState = async ({ root, headRef }: { root: string; headRef?: string | undefined }): Promise<GitLogical> => {
  const [head, ref, staged] = await Promise.all([
    captureGit({ args: ['rev-parse', '-q', '--verify', 'HEAD'], cwd: root }),
    captureGit({ args: ['symbolic-ref', '-q', 'HEAD'], cwd: root }),
    captureGit({ args: ['ls-files', '--stage', '-v', '-z'], cwd: root }),
  ])
  if (!staged.ok) throw new Error(`Cannot read the git index of ${root}: ${staged.stderr.trim()}`)
  const headText = head.ok ? head.stdout.trim() : UNBORN
  const refText = headRef ?? (ref.ok ? ref.stdout.trim() : DETACHED)
  return {
    head: head.ok ? headText : null,
    branch: ref.ok && refText.startsWith(BRANCH_PREFIX) ? refText.slice(BRANCH_PREFIX.length) : null,
    text: `${headText}\n${refText}\n${staged.stdout}`,
  }
}

const worktreePathsOf = async ({ root }: { root: string }): Promise<readonly string[] | null> => {
  const top = await captureGit({ args: ['rev-parse', '--show-toplevel'], cwd: root })
  if (!top.ok) return null
  return (await listCapturedWorktrees({ cwd: root })).map((worktree) => worktree.path)
}

export type TreeSnapshot = { fingerprint: string; head: string | null; branch: string | null }

export async function snapshotWorkspaceTree({
  cwd,
  excludedRoots = [],
  headRef,
  pointerMap = new Map(),
}: {
  cwd: string
  excludedRoots?: readonly string[]
  headRef?: string | undefined
  pointerMap?: PointerMap | undefined
}): Promise<TreeSnapshot> {
  const root = await realpath(cwd)
  const worktrees = await worktreePathsOf({ root })
  const excluded = [...excludedRoots, ...(worktrees ?? []).filter((path) => path !== root)]
  const ignore = worktrees === null ? noIgnoreFilter : await resolveIgnoreFilter({ cwd: root })
  const walk = await walkTree({
    root,
    isSkipped: treeSkipRule({
      root,
      excludedRoots: excluded,
      isCaptured: ignore.isCaptured,
      isCapturedDir: ignore.isCapturedDir,
    }),
  })
  assertPortable({ unportable: walk.unportable, label: root })

  const logical = worktrees === null ? null : await gitLogicalState({ root, headRef })
  const hash = createHash('sha256')
  hash.update(logical === null ? 'plain\n' : logical.text)
  await feedEntries({ root, entries: walk.entries, hash, pointers: pointerMap })
  return { fingerprint: hash.digest('hex'), head: logical?.head ?? null, branch: logical?.branch ?? null }
}

export async function fingerprintWorkspaceTree(args: {
  cwd: string
  excludedRoots?: readonly string[]
  headRef?: string | undefined
  pointerMap?: PointerMap | undefined
}): Promise<string> {
  return (await snapshotWorkspaceTree(args)).fingerprint
}
