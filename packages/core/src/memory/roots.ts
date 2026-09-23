import { EDefinitionOrigin } from '../discovery/origin'

export const MEMORY_DIRECTORY_NAME = 'memory'
export const MEMORY_PROJECTS_DIRECTORY_NAME = 'projects'
export const MEMORY_INDEX_NAME = 'MEMORY.md'

const SEPARATOR = '/'
const MAX_SANITISED_LENGTH = 200

export type MemoryRoot = {
  directory: string
  origin: EDefinitionOrigin
}

const withoutTrailingSeparator = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.length === 0 ? SEPARATOR : trimmed
}

const under = (args: { directory: string; name: string }): string => {
  const base = withoutTrailingSeparator(args.directory)
  return base === SEPARATOR ? `${SEPARATOR}${args.name}` : `${base}${SEPARATOR}${args.name}`
}

const fingerprint = (value: string): string => {
  let hash = 2166136261
  for (let at = 0; at < value.length; at += 1) {
    hash ^= value.charCodeAt(at)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function sanitiseRepoPath(repoRoot: string): string {
  const flattened = repoRoot.replace(/[^a-zA-Z0-9]/g, '-')
  if (flattened.length <= MAX_SANITISED_LENGTH) return flattened

  return `${flattened.slice(0, MAX_SANITISED_LENGTH)}-${fingerprint(repoRoot)}`
}

/**
 * The on-disk form of a normalized repo identity (`github.com/org/repo`): each segment is made
 * filename-safe but the hierarchy is kept, so the projects directory stays browsable by host.
 */
export function sanitiseRepoIdentity(identity: string): string {
  const segments = identity
    .split(SEPARATOR)
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, '-'))
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  const joined = segments.join(SEPARATOR)
  if (joined.length <= MAX_SANITISED_LENGTH) return joined

  return `${joined.slice(0, MAX_SANITISED_LENGTH)}-${fingerprint(identity)}`
}

export function memoryRootPlan(args: {
  atlasHome: string
  repoRoot: string
  identity?: string | null | undefined
}): readonly MemoryRoot[] {
  const projects = under({
    directory: args.atlasHome,
    name: MEMORY_PROJECTS_DIRECTORY_NAME,
  })

  const projectKey =
    args.identity === undefined || args.identity === null
      ? sanitiseRepoPath(args.repoRoot)
      : sanitiseRepoIdentity(args.identity)

  return [
    {
      directory: under({ directory: args.atlasHome, name: MEMORY_DIRECTORY_NAME }),
      origin: EDefinitionOrigin.User,
    },
    {
      directory: under({
        directory: under({ directory: projects, name: projectKey }),
        name: MEMORY_DIRECTORY_NAME,
      }),
      origin: EDefinitionOrigin.Project,
    },
  ]
}

export const memoryIndexIn = (directory: string): string =>
  under({ directory, name: MEMORY_INDEX_NAME })

export function isMemoryFile(args: {
  path: string
  directories: readonly string[]
}): boolean {
  const at = args.path.lastIndexOf(SEPARATOR)
  if (at < 0) return false

  const name = args.path.slice(at + 1)
  if (!name.endsWith('.md') || name === MEMORY_INDEX_NAME) return false

  const parent = withoutTrailingSeparator(args.path.slice(0, at + 1))
  return args.directories.some((directory) => withoutTrailingSeparator(directory) === parent)
}
