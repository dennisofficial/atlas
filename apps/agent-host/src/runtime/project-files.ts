import { isAbsolute, relative, resolve, sep } from 'node:path'

import {
  ATLAS_HOME_MOUNT_PREFIX,
  EFileMountTarget,
  fileMountPathProblem,
  fileMountRelativePathOf,
  fileMountTargetOf,
  type ScopedFileMount,
} from '@dltech/atlas-wire/web'

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
  atlasHome?: string | undefined
}

export type ProjectFilePlan = {
  writes: readonly ProjectFileWrite[]
  outcomes: readonly ProjectFileOutcome[]
}

export const isInside = (args: { root: string; target: string }): boolean => {
  const path = relative(args.root, args.target)
  const [firstSegment] = path.split(sep)
  return path === '' || (path !== '..' && firstSegment !== '..' && !isAbsolute(path))
}

const rootOf = (args: { mount: ScopedFileMount; roots: ProjectFileRoots }): string | null => {
  if (args.mount.path.startsWith(ATLAS_HOME_MOUNT_PREFIX)) return args.roots.atlasHome ?? null
  return fileMountTargetOf(args.mount.path) === EFileMountTarget.Home
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
  const repository = fileMountTargetOf(path) === EFileMountTarget.Repository
  if (path.startsWith(ATLAS_HOME_MOUNT_PREFIX) && args.roots.atlasHome === undefined) {
    return { path, state: EProjectFileState.Failed, reason: 'the sandbox has no atlas home' }
  }
  if (fileMountTargetOf(path) === EFileMountTarget.Home && args.roots.home === null) {
    return { path, state: EProjectFileState.SkippedNoHome, reason: 'the sandbox home is unknown' }
  }
  const root = rootOf({ mount: args.mount, roots: args.roots })
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
    repository,
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
