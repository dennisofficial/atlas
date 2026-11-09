import { isAbsolute, resolve } from 'node:path'

import type { ActiveWorktree } from '@dltech/atlas-core'
import type { PodWorktrees, WorktreeEntryInfo, WorktreeRecord } from '@dltech/atlas-plugin-sdk'

export const WORKTREE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/

export const MAX_WORKTREE_NAME_LENGTH = 64

export type Plan =
  | { ok: true; entry: WorktreeEntryInfo; text: string }
  | { ok: false; reason: string }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const nameComplaint = (name: string): string | undefined => {
  if (name.length > MAX_WORKTREE_NAME_LENGTH) {
    return `a worktree name is at most ${MAX_WORKTREE_NAME_LENGTH} characters, and "${name}" is ${name.length}`
  }
  if (!WORKTREE_NAME_PATTERN.test(name)) {
    return `"${name}" is not a usable worktree name: each slash-separated segment may hold only letters, digits, dots, underscores and dashes, and must begin with a letter or digit`
  }
  return undefined
}

const refusalOf = (record: WorktreeRecord): string | undefined => {
  if (record.isMain) {
    return `${record.path} is the main checkout of the repository, not a worktree of it. exit_worktree returns the session there; there is nothing to enter.`
  }
  if (record.bare)
    return `the worktree at ${record.path} is bare, so it has no working tree to run in`
  if (record.prunable) {
    return `git considers the worktree at ${record.path} prunable, so it is not a checkout the session can work in. Tell the developer and let them repair it or run git worktree prune.`
  }
  if (record.detached || record.branch === null) {
    return `the worktree at ${record.path} has a detached HEAD, so there is no branch to work on`
  }
  return undefined
}

const matchedOf = (args: {
  records: readonly WorktreeRecord[]
  projectDirectory: string
  repository: string
  path: string
}): WorktreeRecord | undefined => {
  const candidates = isAbsolute(args.path)
    ? [args.path]
    : [resolve(args.projectDirectory, args.path), resolve(args.repository, args.path)]
  return args.records.find((record) => candidates.includes(record.path))
}

const stateLine = (state: {
  changedCount: number
  unpushedCommits: number
  upstream: string | undefined
}): string => {
  const parts = [
    state.changedCount === 0
      ? 'no uncommitted changes'
      : `${state.changedCount} uncommitted ${state.changedCount === 1 ? 'file' : 'files'}`,
  ]
  if (state.upstream === undefined) {
    parts.push('and no upstream branch, so nothing to compare against')
    return `It holds ${parts.join(' ')}.`
  }
  parts.push(`and, against ${state.upstream}, ${state.unpushedCommits} ahead`)
  return `It holds ${parts.join(' ')}.`
}

export const adoptedTextOf = (args: {
  entry: WorktreeEntryInfo
  state: { changedCount: number; unpushedCommits: number; upstream: string | undefined }
}): string =>
  [
    `Moved into the existing worktree at ${args.entry.path}, on branch ${args.entry.branch}.`,
    `Atlas did not create it, so exit_worktree will leave it on disk however it is called.`,
    stateLine(args.state),
    'That worktree is the project directory now: a path you pass to a tool resolves against it, and a bash command starts there.',
  ].join(' ')

export async function enterByName(args: {
  worktrees: PodWorktrees
  projectDirectory: string
  activeWorktree: ActiveWorktree | undefined
  name: string
}): Promise<Plan> {
  const complaint = nameComplaint(args.name)
  if (complaint !== undefined) return { ok: false, reason: complaint }
  if (args.activeWorktree !== undefined) {
    return {
      ok: false,
      reason: `the session is already in the worktree at ${args.activeWorktree.path}. Leave it with exit_worktree before creating another, or switch straight to an existing one by passing its path.`,
    }
  }
  try {
    const entry = await args.worktrees.create({ cwd: args.projectDirectory, name: args.name })
    return {
      ok: true,
      entry,
      text: [
        `Created a worktree at ${entry.path} on a new branch ${entry.branch}, cut from ${entry.base}.`,
        ...(entry.staleBase === true
          ? [
              `The fetch from origin failed, so the branch was cut from whatever ${entry.base} already pointed at locally.`,
            ]
          : []),
        'That worktree is the project directory now: a path you pass to a tool resolves against it, and a bash command starts there.',
        'The repository this worktree came from stays checked out where it was; leave that checkout alone.',
      ].join(' '),
    }
  } catch (error) {
    return { ok: false, reason: messageOf(error) }
  }
}

export async function enterByPath(args: {
  worktrees: PodWorktrees
  projectDirectory: string
  path: string
  createdHere: (path: string) => boolean
}): Promise<Plan> {
  let repository: string
  let records: readonly WorktreeRecord[]
  try {
    const listing = await args.worktrees.list({ cwd: args.projectDirectory })
    repository = listing.repository
    records = listing.worktrees
  } catch (error) {
    return { ok: false, reason: messageOf(error) }
  }

  const matched = matchedOf({
    records,
    projectDirectory: args.projectDirectory,
    repository,
    path: args.path,
  })
  if (matched === undefined) {
    const listed = records.map((record) => record.path).join(', ')
    return {
      ok: false,
      reason: `${args.path} is not a worktree git lists for the repository at ${repository}. It lists: ${listed}.`,
    }
  }
  const refusal = refusalOf(matched)
  if (refusal !== undefined) return { ok: false, reason: refusal }

  const ours = args.createdHere(matched.path)
  const entry: WorktreeEntryInfo = {
    path: matched.path,
    branch: matched.branch ?? '',
    adopted: !ours,
  }
  try {
    const state = await args.worktrees.inspect({ cwd: matched.path })
    return {
      ok: true,
      entry,
      text: ours
        ? `Moved into the worktree at ${entry.path}, on branch ${entry.branch}, which this session created. ${stateLine(state)} That worktree is the project directory now: a path you pass to a tool resolves against it, and a bash command starts there.`
        : adoptedTextOf({ entry, state }),
    }
  } catch (error) {
    return { ok: false, reason: messageOf(error) }
  }
}

export async function planTarget(args: {
  worktrees: PodWorktrees
  projectDirectory: string
  activeWorktree: ActiveWorktree | undefined
  createdHere: (path: string) => boolean
  target: string
}): Promise<Plan> {
  const listing = await args.worktrees.list({ cwd: args.projectDirectory }).catch(() => undefined)
  const matched =
    listing === undefined
      ? undefined
      : matchedOf({
          records: listing.worktrees,
          projectDirectory: args.projectDirectory,
          repository: listing.repository,
          path: args.target,
        })
  if (matched !== undefined) {
    return await enterByPath({ ...args, path: args.target, createdHere: args.createdHere })
  }
  return await enterByName({ ...args, name: args.target })
}
