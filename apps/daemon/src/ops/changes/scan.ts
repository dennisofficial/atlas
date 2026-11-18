import { EChangeFileStatus, type ChangesManifest, type ChangesScanOp } from '@dltech/atlas-protocol'

import type { DaemonOpsDeps } from '../deps'
import { runGit } from '../git/git'
import { EMPTY_TREE, baseSide, currentSide, resolveBase, type ResolvedSide } from './sides'

type Counts = { additions: number; deletions: number; binary: boolean }
type Named = { status: EChangeFileStatus; oldPath: string | null }

const UNTRACKED: Named = { status: EChangeFileStatus.Added, oldPath: null }

const STATUS_OF: Readonly<Record<string, EChangeFileStatus>> = {
  A: EChangeFileStatus.Added,
  D: EChangeFileStatus.Deleted,
  M: EChangeFileStatus.Modified,
  T: EChangeFileStatus.Modified,
  R: EChangeFileStatus.Modified,
  C: EChangeFileStatus.Modified,
}

const countOf = (text: string | undefined): number => {
  const parsed = text === undefined ? Number.NaN : Number.parseInt(text, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

const numstatOf = (output: string): Map<string, Counts> => {
  const tokens = output.split('\0')
  const counts = new Map<string, Counts>()
  for (let index = 0; index < tokens.length; index += 1) {
    const fields = (tokens[index] ?? '').split('\t')
    if (fields.length !== 3) continue
    const [added, removed, name] = fields
    let path = name ?? ''
    if (path === '') {
      path = tokens[index + 2] ?? ''
      index += 2
    }
    if (path === '') continue
    const binary = added === '-' || removed === '-'
    counts.set(path, {
      additions: binary ? 0 : countOf(added),
      deletions: binary ? 0 : countOf(removed),
      binary,
    })
  }
  return counts
}

const nameStatusOf = (output: string): Map<string, Named> => {
  const tokens = output.split('\0')
  const named = new Map<string, Named>()
  for (let index = 0; index < tokens.length; index += 1) {
    const code = tokens[index] ?? ''
    if (code === '') continue
    const kind = code.charAt(0)
    const status = STATUS_OF[kind] ?? EChangeFileStatus.Modified
    if (kind === 'R' || kind === 'C') {
      const oldPath = tokens[index + 1] ?? ''
      const path = tokens[index + 2] ?? ''
      index += 2
      if (path !== '') named.set(path, { status, oldPath: oldPath === '' ? null : oldPath })
      continue
    }
    const path = tokens[index + 1] ?? ''
    index += 1
    if (path !== '') named.set(path, { status, oldPath: null })
  }
  return named
}

const hasNul = (side: ResolvedSide): boolean => side.bytes.includes(0)

const lineCountOf = (side: ResolvedSide): number => {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(side.bytes)
  if (text === '') return 0
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length
}

const entryOf = async (args: {
  deps: DaemonOpsDeps
  repoPath: string
  ref: string
  path: string
  named: Named
  counts: Counts
}) => {
  const base = await baseSide({
    deps: args.deps,
    repoPath: args.repoPath,
    ref: args.ref,
    path: args.named.oldPath ?? args.path,
  })
  const current = await currentSide({ repoPath: args.repoPath, path: args.path })
  const directory = current === 'directory'
  const live = directory ? null : current
  const untracked = args.named.status === EChangeFileStatus.Added && base === null
  const binary = directory || args.counts.binary || (untracked && live !== null && hasNul(live))
  return {
    path: args.path,
    oldPath: args.named.oldPath,
    status: args.named.status,
    additions: untracked && !binary && live !== null ? lineCountOf(live) : args.counts.additions,
    deletions: args.counts.deletions,
    binary,
    baseHash: base?.hash ?? null,
    currentHash: live?.hash ?? null,
    baseSize: base?.size ?? null,
    currentSize: live?.size ?? null,
  }
}

export const scanChanges = async (args: {
  deps: DaemonOpsDeps
  op: ChangesScanOp
}): Promise<ChangesManifest> => {
  const { deps, op } = args
  const resolved = await resolveBase({ deps, repoPath: op.repoPath, base: op.base })
  const ref = resolved ?? EMPTY_TREE
  const common = ['-c', 'core.quotepath=off', 'diff', '-M', '--no-color', '--no-ext-diff', '-z']
  const numstat = numstatOf(
    await runGit({ deps, repoPath: op.repoPath, argv: [...common, '--numstat', ref, '--'] }),
  )
  const named = nameStatusOf(
    await runGit({ deps, repoPath: op.repoPath, argv: [...common, '--name-status', ref, '--'] }),
  )
  const others = await runGit({
    deps,
    repoPath: op.repoPath,
    argv: ['ls-files', '-z', '--others', '--exclude-standard'],
  })
  const paths = new Set<string>([...named.keys(), ...numstat.keys()])
  for (const path of others.split('\0')) if (path !== '') paths.add(path)
  const files = []
  for (const path of [...paths].sort()) {
    files.push(
      await entryOf({
        deps,
        repoPath: op.repoPath,
        ref,
        path,
        named: named.get(path) ?? UNTRACKED,
        counts: numstat.get(path) ?? { additions: 0, deletions: 0, binary: false },
      }),
    )
  }
  return { repoPath: op.repoPath, base: resolved, files }
}
