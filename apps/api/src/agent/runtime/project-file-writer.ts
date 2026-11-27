import { randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'

import type { FileSystemPort, ProcessPort } from '@dltech/atlas-core'

import { isTracked, repositoryFactsOf, type RepositoryFacts } from './project-file-git'
import {
  EProjectFileState,
  projectFilePlanOf,
  type ProjectFileOutcome,
  type ProjectFileRoots,
  type ProjectFileWrite,
  type ScopedFileMount,
} from './project-files'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'it failed for a reason it did not name'

const excludeLineOf = (relativePath: string): string =>
  `/${relativePath
    .replace(/[\\*?[]/g, (character) => `\\${character}`)
    .replace(/^[#!]/, (character) => `\\${character}`)
    .replace(/ +$/, (spaces) => spaces.replace(/ /g, '\\ '))}`

const excludeLocally = async (args: {
  files: FileSystemPort
  excludeFile: string | null
  relativePaths: readonly string[]
}): Promise<void> => {
  if (args.excludeFile === null) throw new Error('git did not name its exclude file')
  const existing = await args.files.readFile({ path: args.excludeFile }).catch(() => '')
  const present = new Set(existing.split('\n').map((entry) => entry.replace(/\r$/, '')))
  const missing = [...new Set(args.relativePaths.map(excludeLineOf))].filter(
    (line) => !present.has(line),
  )
  if (missing.length === 0) return
  await args.files.mkdir({ path: dirname(args.excludeFile) })
  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n'
  await args.files.writeFile({
    path: args.excludeFile,
    content: `${existing}${separator}${missing.map((line) => `${line}\n`).join('')}`,
  })
}

const writeAtomically = async (args: {
  files: FileSystemPort
  write: ProjectFileWrite
}): Promise<void> => {
  const directory = dirname(args.write.target)
  await args.files.mkdir({ path: directory })
  const staged = resolve(directory, `.atlas-${randomBytes(8).toString('hex')}.tmp`)
  await args.files.writeFile({ path: staged, content: args.write.contents, mode: args.write.mode })
  try {
    await args.files.rename({ from: staged, to: args.write.target })
  } catch (error) {
    await args.files.removeFile({ path: staged }).catch(() => undefined)
    throw error
  }
}

const writeOne = async (args: {
  files: FileSystemPort
  write: ProjectFileWrite
}): Promise<ProjectFileOutcome> => {
  try {
    await writeAtomically({ files: args.files, write: args.write })
    return { path: args.write.path, state: EProjectFileState.Written }
  } catch (error) {
    return { path: args.write.path, state: EProjectFileState.Failed, reason: messageOf(error) }
  }
}

const refusalOf = (args: {
  facts: RepositoryFacts
  write: ProjectFileWrite
}): ProjectFileOutcome | null => {
  const { facts, write } = args
  if (!facts.inWorkTree) return { path: write.path, state: EProjectFileState.SkippedNoRepository }
  if (facts.tracked === null) {
    return {
      path: write.path,
      state: EProjectFileState.Failed,
      reason: 'git could not check whether the path is tracked',
    }
  }
  if (isTracked({ tracked: facts.tracked, path: write.relativePath })) {
    return { path: write.path, state: EProjectFileState.SkippedTracked }
  }
  if (facts.ignored === null) {
    return {
      path: write.path,
      state: EProjectFileState.Failed,
      reason: 'git could not check whether the path is ignored',
    }
  }
  return null
}

const writeInRepository = async (args: {
  files: FileSystemPort
  processes: ProcessPort
  root: string
  writes: readonly ProjectFileWrite[]
  signal?: AbortSignal | undefined
}): Promise<ProjectFileOutcome[]> => {
  const { files, writes } = args
  const facts = await repositoryFactsOf({
    processes: args.processes,
    root: args.root,
    relativePaths: writes.map((write) => write.relativePath),
    signal: args.signal,
  })
  const written = await Promise.all(
    writes.map((write) => refusalOf({ facts, write }) ?? writeOne({ files, write })),
  )
  const toExclude = writes.filter(
    (write, index) =>
      written[index]?.state === EProjectFileState.Written &&
      facts.ignored?.has(write.relativePath) === false,
  )
  if (toExclude.length === 0) return written
  const failure = await excludeLocally({
    files,
    excludeFile: facts.excludeFile,
    relativePaths: toExclude.map((write) => write.relativePath),
  }).then(
    (): string | undefined => undefined,
    (error: unknown) => messageOf(error),
  )
  const excludedPaths = new Set(toExclude.map((write) => write.path))
  return written.map((outcome) => {
    if (!excludedPaths.has(outcome.path)) return outcome
    return failure === undefined
      ? { path: outcome.path, state: EProjectFileState.WrittenLocallyExcluded }
      : { path: outcome.path, state: EProjectFileState.WrittenNotExcluded, reason: failure }
  })
}

const byRoot = (writes: readonly ProjectFileWrite[]): Map<string, ProjectFileWrite[]> => {
  const groups = new Map<string, ProjectFileWrite[]>()
  for (const write of writes) groups.set(write.root, [...(groups.get(write.root) ?? []), write])
  return groups
}

export const writeProjectFiles = async (args: {
  mounts: readonly ScopedFileMount[]
  files: FileSystemPort
  processes: ProcessPort
  roots: ProjectFileRoots
  signal?: AbortSignal | undefined
}): Promise<readonly ProjectFileOutcome[]> => {
  if (args.mounts.length === 0) return []
  const plan = projectFilePlanOf({ mounts: args.mounts, roots: args.roots })
  const outcomeOf = new Map<ProjectFileWrite, ProjectFileOutcome>()
  const repositoryGroups = [...byRoot(plan.writes.filter((write) => write.repository))]
  await Promise.all([
    ...plan.writes
      .filter((write) => !write.repository)
      .map(async (write) => outcomeOf.set(write, await writeOne({ files: args.files, write }))),
    ...repositoryGroups.map(async ([root, writes]) => {
      const outcomes = await writeInRepository({ ...args, root, writes })
      writes.forEach((write, index) => {
        const outcome = outcomes[index]
        if (outcome !== undefined) outcomeOf.set(write, outcome)
      })
    }),
  ])
  return [
    ...plan.outcomes,
    ...plan.writes.flatMap((write) => {
      const outcome = outcomeOf.get(write)
      return outcome === undefined ? [] : [outcome]
    }),
  ]
}
