import { cp, lstat, mkdir, realpath, symlink } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import {
  EWorktreeFileMode,
  EWorktreeFileSkip,
  EWorktreeFilesState,
  EWorktreePatternRefusal,
  planWorktreeFiles,
  type FailedWorktreeFile,
  type RefusedWorktreeEntry,
  type SkippedWorktreeFile,
  type WorktreeFileMatch,
  type WorktreeFilesOutcome,
} from '@dltech/atlas-core'

import { runGit } from '../run-git'
import { EWorktreeFilesLoad, WORKTREE_FILE, loadWorktreeFiles } from './load'
import { matchWorktreePattern } from './match'

const detailOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const exists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

const isInside = (args: { root: string; path: string }): boolean => {
  const relation = relative(args.root, args.path)
  return !relation.startsWith('..') && !relation.startsWith('/')
}

const trackedPaths = async (root: string): Promise<readonly string[] | string> => {
  const listed = await runGit({ args: ['ls-files', '-z'], cwd: root })
  if (!listed.ok) return listed.stderr.trim()
  return listed.stdout.split('\0').filter((path) => path !== '')
}

const skippedInWorktree = (args: { source: string; worktree: string }): ReadonlySet<string> => {
  const relation = relative(args.source, args.worktree)
  return new Set(relation.startsWith('..') ? [] : [relation])
}

const place = async (args: {
  source: string
  worktree: string
  match: WorktreeFileMatch
}): Promise<void> => {
  const from = join(args.source, args.match.path)
  const to = join(args.worktree, args.match.path)
  await mkdir(dirname(to), { recursive: true })
  if (args.match.mode === EWorktreeFileMode.Link) {
    await symlink(from, to)
    return
  }
  await cp(from, to, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true })
}

export async function applyWorktreeFiles({
  source,
  worktree,
}: {
  source: string
  worktree: string
}): Promise<WorktreeFilesOutcome> {
  const loaded = await loadWorktreeFiles({ root: source })
  if (loaded.load === EWorktreeFilesLoad.Absent) return { state: EWorktreeFilesState.Absent }
  if (loaded.load === EWorktreeFilesLoad.Invalid) {
    return { state: EWorktreeFilesState.Invalid, file: WORKTREE_FILE, error: loaded.error }
  }

  const tracked = await trackedPaths(source)
  if (typeof tracked === 'string') {
    return {
      state: EWorktreeFilesState.Invalid,
      file: WORKTREE_FILE,
      error: `git could not list the tracked files of ${source} (${tracked})`,
    }
  }

  const realSource = await realpath(source)
  const skip = skippedInWorktree({ source, worktree })
  const refused: RefusedWorktreeEntry[] = [...loaded.config.refused]
  const missing: string[] = []
  const matches: WorktreeFileMatch[] = []
  for (const { pattern, mode } of loaded.config.patterns) {
    const { paths, escaped } = await matchWorktreePattern({ root: source, pattern, skip })
    for (const path of escaped) {
      refused.push({ entry: path, mode, refusal: EWorktreePatternRefusal.OutsideRepository })
    }
    if (paths.length === 0 && escaped.length === 0) missing.push(pattern)
    for (const path of paths) {
      const parent = await realpath(dirname(join(source, path)))
      if (isInside({ root: realSource, path: parent })) matches.push({ path, mode })
      else refused.push({ entry: path, mode, refusal: EWorktreePatternRefusal.OutsideRepository })
    }
  }

  const plan = planWorktreeFiles({ matches, tracked })
  if (!plan.ok) {
    return {
      state: EWorktreeFilesState.Invalid,
      file: WORKTREE_FILE,
      error: `${plan.conflicts.join(', ')} matched by both copy and link`,
    }
  }

  const copied: string[] = []
  const linked: string[] = []
  const failed: FailedWorktreeFile[] = []
  const skipped: SkippedWorktreeFile[] = plan.tracked.map((match) => ({
    ...match,
    skip: EWorktreeFileSkip.Tracked,
  }))
  for (const match of plan.actions) {
    if (await exists(join(worktree, match.path))) {
      skipped.push({ ...match, skip: EWorktreeFileSkip.Present })
      continue
    }
    try {
      await place({ source, worktree, match })
      if (match.mode === EWorktreeFileMode.Link) linked.push(match.path)
      else copied.push(match.path)
    } catch (error) {
      failed.push({ ...match, detail: detailOf(error) })
    }
  }

  return {
    state: EWorktreeFilesState.Applied,
    file: WORKTREE_FILE,
    source,
    result: { copied, linked, skipped, missing, refused, failed },
  }
}
