import { gitOneLine } from './git-text'
import { runGit, type GitRun } from './run-git'

export type GitReader = (args: { args: readonly string[]; cwd: string }) => Promise<GitRun>

export type WorkspaceSnapshot = {
  remoteUrl: string | null
  branch: string | null
  commit: string | null
  patch: string
}

const DETACHED = 'HEAD'

const INSIDE = 'true'

const NOTHING_UNCOMMITTED = ''

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

  return gitOneLine(await read({ args: ['remote', 'get-url', name], cwd }))
}

const branchOf = async (read: GitReader, cwd: string): Promise<string | null> => {
  const branch = gitOneLine(await read({ args: ['rev-parse', '--abbrev-ref', 'HEAD'], cwd }))
  return branch === DETACHED ? null : branch
}

const commitOf = (read: GitReader, cwd: string): Promise<string | null> =>
  read({ args: ['rev-parse', 'HEAD'], cwd }).then(gitOneLine)

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

export async function captureWorkspace(args: {
  cwd: string
  read?: GitReader | undefined
}): Promise<WorkspaceSnapshot | null> {
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
