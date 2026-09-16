import { runGit, type GitRun } from '@dltech/atlas-harness'

import type { LiftedWorkspace } from './cloud-bridge'

export type GitReader = (args: { args: readonly string[]; cwd: string }) => Promise<GitRun>

const DETACHED = 'HEAD'

const INSIDE = 'true'

const NOTHING_UNCOMMITTED = ''

const oneLine = (run: GitRun): string | null => {
  if (!run.ok) return null

  const line = run.stdout.split('\n')[0]?.trim() ?? ''
  return line.length === 0 ? null : line
}

const insideRepository = async (read: GitReader, cwd: string): Promise<boolean> => {
  const inside = await read({ args: ['rev-parse', '--is-inside-work-tree'], cwd })
  return inside.ok && inside.stdout.trim() === INSIDE
}

const remoteNameOf = async (read: GitReader, cwd: string): Promise<string | null> => {
  const named = await read({ args: ['remote'], cwd })
  if (!named.ok) return null

  const names = named.stdout
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
  if (names.includes('origin')) return 'origin'
  return names[0] ?? null
}

const remoteUrlOf = async (read: GitReader, cwd: string): Promise<string | null> => {
  const name = await remoteNameOf(read, cwd)
  if (name === null) return null

  return oneLine(await read({ args: ['remote', 'get-url', name], cwd }))
}

const branchOf = async (read: GitReader, cwd: string): Promise<string | null> => {
  const branch = oneLine(await read({ args: ['rev-parse', '--abbrev-ref', 'HEAD'], cwd }))
  return branch === DETACHED ? null : branch
}

const commitOf = (read: GitReader, cwd: string): Promise<string | null> =>
  read({ args: ['rev-parse', 'HEAD'], cwd }).then(oneLine)

/**
 * `git diff --no-index` answers 1 when the files differ, which is the whole point of the call, so
 * the diff is read off stdout rather than off the exit status.
 */
const untrackedPatchOf = async (args: {
  read: GitReader
  cwd: string
  path: string
}): Promise<string> => {
  const diffed = await args.read({
    args: ['diff', '--no-index', '--binary', '--', '/dev/null', args.path],
    cwd: args.cwd,
  })
  return diffed.stdout
}

const untrackedPathsOf = async (read: GitReader, cwd: string): Promise<readonly string[]> => {
  const listed = await read({ args: ['ls-files', '--others', '--exclude-standard'], cwd })
  if (!listed.ok) return []

  return listed.stdout
    .split('\n')
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
}

const trackedPatchOf = async (args: {
  read: GitReader
  cwd: string
  since: string
}): Promise<string> => {
  const diffed = await args.read({ args: ['diff', '--binary', args.since], cwd: args.cwd })
  return diffed.ok ? diffed.stdout : NOTHING_UNCOMMITTED
}

/**
 * The work in progress as a unified diff, tracked edits first and then each untracked file. It is
 * deliberately not a commit: a lift moves machines without touching the branch's history.
 *
 * `since` is a resolved commit rather than `HEAD` because the sandbox runs `git apply` all-or-
 * nothing against the commit the lift reported. Diffing the symbolic ref would let a commit landing
 * mid-capture produce a patch that no longer applies to the checkout it is paired with.
 */
export async function uncommittedPatch(args: {
  cwd: string
  since: string | null
  read?: GitReader | undefined
}): Promise<string> {
  const read = args.read ?? runGit
  const tracked =
    args.since === null
      ? NOTHING_UNCOMMITTED
      : await trackedPatchOf({ read, cwd: args.cwd, since: args.since })

  const untracked: string[] = []
  for (const path of await untrackedPathsOf(read, args.cwd)) {
    const patch = await untrackedPatchOf({ read, cwd: args.cwd, path })
    if (patch.length > 0) untracked.push(patch)
  }

  return [tracked, ...untracked].filter((part) => part.length > 0).join('')
}

/**
 * `null` when there is no repository here at all: the control plane takes that as a session with no
 * code to materialise, which it is told by being sent no workspace rather than a spec full of nulls.
 */
export async function captureWorkspace(args: {
  cwd: string
  read?: GitReader | undefined
}): Promise<LiftedWorkspace | null> {
  const read = args.read ?? runGit
  if (!(await insideRepository(read, args.cwd))) return null

  const commit = await commitOf(read, args.cwd)
  const [remoteUrl, branch, patch] = await Promise.all([
    remoteUrlOf(read, args.cwd),
    branchOf(read, args.cwd),
    uncommittedPatch({ cwd: args.cwd, since: commit, read }),
  ])

  return { remoteUrl, branch, commit, patch }
}
