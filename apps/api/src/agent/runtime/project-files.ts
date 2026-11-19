import { isAbsolute, relative, resolve, sep } from 'node:path'

const HOME_MOUNT_PREFIX = '~/'
const ATLAS_HOME_MOUNT_PREFIX = '@/'

export enum EFileMountTarget {
  Repository = 'repository',
  Home = 'home',
}

export type ScopedFileMount = { path: string; contents: string; mode: number }

export const fileMountTargetOf = (path: string): EFileMountTarget =>
  path.startsWith(HOME_MOUNT_PREFIX) || path.startsWith(ATLAS_HOME_MOUNT_PREFIX)
    ? EFileMountTarget.Home
    : EFileMountTarget.Repository

export const fileMountRelativePathOf = (path: string): string => {
  if (path.startsWith(ATLAS_HOME_MOUNT_PREFIX)) return path.slice(ATLAS_HOME_MOUNT_PREFIX.length)
  return fileMountTargetOf(path) === EFileMountTarget.Home
    ? path.slice(HOME_MOUNT_PREFIX.length)
    : path
}

export const fileMountPathProblem = (path: string): string | null => {
  const relativePath = fileMountRelativePathOf(path)
  if (relativePath.length === 0) return 'Enter a file path'
  if (relativePath.startsWith('/')) {
    return 'Use a path relative to the repository, or start it with ~/'
  }
  if (relativePath.includes('\\')) return 'Use / to separate folders'
  const segments = relativePath.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'Remove empty, . and .. folders from the path'
  }
  if (fileMountTargetOf(path) === EFileMountTarget.Repository && segments[0] === '.git') {
    return 'Atlas cannot write inside .git'
  }
  return null
}

const isInside = (args: { root: string; target: string }): boolean => {
  const path = relative(args.root, args.target)
  const [firstSegment] = path.split(sep)
  return path === '' || (path !== '..' && firstSegment !== '..' && !isAbsolute(path))
}

export enum EProjectFileState {
  Written = 'written',
  WrittenLocallyExcluded = 'written-locally-excluded',
  WrittenNotExcluded = 'written-not-excluded',
  SkippedTracked = 'skipped-tracked',
  SkippedNoRepository = 'skipped-no-repository',
  SkippedNoHome = 'skipped-no-home',
  Failed = 'failed',
}

export type ProjectFileOutcome = { path: string; state: EProjectFileState; reason?: string }

export type ProjectFileWrite = {
  path: string
  target: string
  relativePath: string
  contents: string
  mode: number
  repository: boolean
  root: string
}

export type ProjectFileRoots = {
  repositoryDir: string | null
  home: string | null
  atlasHome: string
}

export type ProjectFilePlan = {
  writes: readonly ProjectFileWrite[]
  outcomes: readonly ProjectFileOutcome[]
}

const isAtlasHome = (path: string): boolean => path.startsWith(ATLAS_HOME_MOUNT_PREFIX)

const rootOf = (args: { path: string; roots: ProjectFileRoots }): string | null => {
  if (isAtlasHome(args.path)) return args.roots.atlasHome
  return fileMountTargetOf(args.path) === EFileMountTarget.Home
    ? args.roots.home
    : args.roots.repositoryDir
}

const plannedOf = (args: {
  mount: ScopedFileMount
  roots: ProjectFileRoots
}): ProjectFileWrite | ProjectFileOutcome => {
  const { path, mode } = args.mount
  const problem = fileMountPathProblem(path)
  if (problem !== null) return { path, state: EProjectFileState.Failed, reason: problem }
  if (
    fileMountTargetOf(path) === EFileMountTarget.Home &&
    !isAtlasHome(path) &&
    args.roots.home === null
  ) {
    return { path, state: EProjectFileState.SkippedNoHome, reason: 'the sandbox home is unknown' }
  }
  const root = rootOf({ path, roots: args.roots })
  if (root === null) return { path, state: EProjectFileState.SkippedNoRepository }
  const relativePath = fileMountRelativePathOf(path)
  const target = resolve(root, relativePath)
  if (!isInside({ root, target })) {
    return { path, state: EProjectFileState.Failed, reason: 'the path leaves its folder' }
  }
  return {
    path,
    target,
    relativePath,
    contents: args.mount.contents,
    mode,
    repository: fileMountTargetOf(path) === EFileMountTarget.Repository,
    root,
  }
}

const isWrite = (entry: ProjectFileWrite | ProjectFileOutcome): entry is ProjectFileWrite =>
  'target' in entry

export const projectFilePlanOf = (args: {
  mounts: readonly ScopedFileMount[]
  roots: ProjectFileRoots
}): ProjectFilePlan => {
  const writes: ProjectFileWrite[] = []
  const outcomes: ProjectFileOutcome[] = []
  for (const entry of args.mounts.map((mount) => plannedOf({ mount, roots: args.roots }))) {
    if (isWrite(entry)) {
      writes.push(entry)
      continue
    }
    outcomes.push(entry)
  }
  return { writes, outcomes }
}
