import { isUnderPath, normalisePath, resolveAgainst } from './classifier/path-set'
import { insideTemporaryRoot, isPersonalDotPath } from './classifier/shapes'

const ownedSessionRoot = (sessionDirectory: string | undefined): string | undefined => {
  if (sessionDirectory === undefined || !sessionDirectory.startsWith('/')) return undefined
  const root = normalisePath({ path: sessionDirectory })
  return root === '/' ? undefined : root
}

export function outsideProjectNotice({
  path,
  projectDirectory,
  sessionDirectory,
}: {
  path: string
  projectDirectory: string
  sessionDirectory?: string | undefined
}): string | undefined {
  const resolved = resolveAgainst({ base: projectDirectory, path })
  const sessionRoot = ownedSessionRoot(sessionDirectory)

  if (sessionRoot !== undefined && isUnderPath({ directory: sessionRoot, path: resolved })) {
    return undefined
  }
  if (isUnderPath({ directory: projectDirectory, path: resolved })) return undefined
  if (insideTemporaryRoot({ path: resolved })) return undefined
  if (isPersonalDotPath({ path: resolved })) return undefined

  return `You just wrote to ${resolved}, which is outside this session's project directory (${projectDirectory}). If the work belongs there — another worktree of this repository, say — switch to it with enter_worktree rather than editing across checkouts, so the session, its diffs and its PR stay in one tree. If it was a deliberate one-off outside the project (config, memory, scratch), carry on.`
}
