import { EWorktreeFileMode } from './config'

export type WorktreeFileMatch = { path: string; mode: EWorktreeFileMode }

export type WorktreeFilesPlan =
  | {
      ok: true
      actions: readonly WorktreeFileMatch[]
      tracked: readonly WorktreeFileMatch[]
    }
  | { ok: false; conflicts: readonly string[] }

export function trackedPathsOf(tracked: readonly string[]): ReadonlySet<string> {
  const covered = new Set<string>()
  for (const path of tracked) {
    covered.add(path)
    let cut = path.lastIndexOf('/')
    while (cut > 0) {
      const directory = path.slice(0, cut)
      if (covered.has(directory)) break
      covered.add(directory)
      cut = directory.lastIndexOf('/')
    }
  }
  return covered
}

const hasMatchedAncestor = (args: { path: string; matched: ReadonlySet<string> }): boolean => {
  let cut = args.path.lastIndexOf('/')
  while (cut > 0) {
    if (args.matched.has(args.path.slice(0, cut))) return true
    cut = args.path.lastIndexOf('/', cut - 1)
  }
  return false
}

export function planWorktreeFiles({
  matches,
  tracked,
}: {
  matches: readonly WorktreeFileMatch[]
  tracked: readonly string[]
}): WorktreeFilesPlan {
  const modes = new Map<string, EWorktreeFileMode>()
  const conflicts = new Set<string>()
  const unique: WorktreeFileMatch[] = []
  for (const match of matches) {
    const known = modes.get(match.path)
    if (known === undefined) {
      modes.set(match.path, match.mode)
      unique.push(match)
      continue
    }
    if (known !== match.mode) conflicts.add(match.path)
  }
  if (conflicts.size > 0) return { ok: false, conflicts: [...conflicts] }

  const matched = new Set(modes.keys())
  const outermost = unique.filter((match) => !hasMatchedAncestor({ path: match.path, matched }))
  const trackedPaths = trackedPathsOf(tracked)
  return {
    ok: true,
    actions: outermost.filter((match) => !trackedPaths.has(match.path)),
    tracked: outermost.filter((match) => trackedPaths.has(match.path)),
  }
}

export const isLinkMode = (mode: EWorktreeFileMode): boolean => mode === EWorktreeFileMode.Link
