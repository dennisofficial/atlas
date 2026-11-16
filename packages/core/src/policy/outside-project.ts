import { isUnderPath, normalisePath, resolveAgainst } from './classifier/path-set'
import { insideTemporaryRoot, isPersonalDotPath } from './classifier/shapes'

const underOwnedRoot = ({
  directory,
  path,
}: {
  directory: string | undefined
  path: string
}): boolean => {
  if (directory === undefined || !directory.startsWith('/')) return false
  const root = normalisePath({ path: directory })
  return root !== '/' && isUnderPath({ directory: root, path })
}

export function outsideProjectNotice({
  path,
  projectDirectory,
  sessionDirectory,
  artifactsDirectory,
}: {
  path: string
  projectDirectory: string
  sessionDirectory?: string | undefined
  artifactsDirectory?: string | undefined
}): string | undefined {
  const resolved = resolveAgainst({ base: projectDirectory, path })

  if (underOwnedRoot({ directory: sessionDirectory, path: resolved })) return undefined
  if (underOwnedRoot({ directory: artifactsDirectory, path: resolved })) return undefined
  if (isUnderPath({ directory: projectDirectory, path: resolved })) return undefined
  if (insideTemporaryRoot({ path: resolved })) return undefined
  if (isPersonalDotPath({ path: resolved })) return undefined

  return `You just wrote to ${resolved}, which is outside this session's project directory (${projectDirectory}). If the work belongs there — another worktree of this repository, say — switch to it with enter_worktree rather than editing across checkouts, so the session, its diffs and its PR stay in one tree. If it was a deliberate one-off outside the project (config, memory, scratch), carry on.`
}
