import { dirname, resolve } from 'node:path'

import {
  EProcessOutcome,
  outcomeOf,
  type FileSystemPort,
  type ProcessPort,
} from '@dltech/atlas-core'
import type { ScopedFileMount } from '@dltech/atlas-wire/web'

import {
  EProjectFileState,
  projectFilePlanOf,
  type ProjectFileOutcome,
  type ProjectFileRoots,
  type ProjectFileWrite,
} from './project-files'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'it failed for a reason it did not name'

const gitExitCode = async (args: {
  processes: ProcessPort
  cwd: string
  argv: readonly string[]
  signal?: AbortSignal | undefined
}): Promise<number> => {
  const handle = args.processes.spawn({ cmd: ['git', ...args.argv], cwd: args.cwd })
  args.signal?.addEventListener('abort', () => handle.terminate(), { once: true })
  const [outcome] = await Promise.all([
    outcomeOf(handle),
    new Response(handle.stdout).text(),
    new Response(handle.stderr).text(),
  ])
  return outcome.kind === EProcessOutcome.Exited ? outcome.code : 1
}

const excludeLineOf = (relativePath: string): string =>
  `/${relativePath
    .replace(/[\\*?[]/g, (character) => `\\${character}`)
    .replace(/^[#!]/, (character) => `\\${character}`)
    .replace(/ +$/, (spaces) => spaces.replace(/ /g, '\\ '))}`

const excludeFileOf = async (args: {
  processes: ProcessPort
  root: string
  signal?: AbortSignal | undefined
}): Promise<string> => {
  const handle = args.processes.spawn({
    cmd: ['git', 'rev-parse', '--git-path', 'info/exclude'],
    cwd: args.root,
  })
  const [outcome, path] = await Promise.all([
    outcomeOf(handle),
    new Response(handle.stdout).text(),
    new Response(handle.stderr).text(),
  ])
  if (outcome.kind !== EProcessOutcome.Exited || outcome.code !== 0 || path.trim() === '') {
    throw new Error('git did not name its exclude file')
  }
  return resolve(args.root, path.trim())
}

const excludeLocally = async (args: {
  files: FileSystemPort
  processes: ProcessPort
  root: string
  relativePath: string
  signal?: AbortSignal | undefined
}): Promise<void> => {
  const file = await excludeFileOf(args)
  const existing = await args.files.readFile({ path: file }).catch(() => '')
  const line = excludeLineOf(args.relativePath)
  if (existing.split('\n').some((entry) => entry.replace(/\r$/, '') === line)) return
  await args.files.mkdir({ path: dirname(file) })
  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n'
  await args.files.writeFile({ path: file, content: `${existing}${separator}${line}\n` })
}

const writeOne = async (args: {
  files: FileSystemPort
  write: ProjectFileWrite
}): Promise<ProjectFileOutcome> => {
  try {
    await args.files.mkdir({ path: dirname(args.write.target) })
    await args.files.writeFile({
      path: args.write.target,
      content: args.write.contents,
      mode: args.write.mode,
    })
    return { path: args.write.path, state: EProjectFileState.Written }
  } catch (error) {
    return { path: args.write.path, state: EProjectFileState.Failed, reason: messageOf(error) }
  }
}

const writeInRepository = async (args: {
  files: FileSystemPort
  processes: ProcessPort
  write: ProjectFileWrite
  signal?: AbortSignal | undefined
}): Promise<ProjectFileOutcome> => {
  const { files, processes, write } = args
  const git = async (argv: readonly string[]): Promise<number> =>
    await gitExitCode({
      processes,
      cwd: write.root,
      argv,
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    })
  if ((await git(['rev-parse', '--is-inside-work-tree'])) !== 0) {
    return { path: write.path, state: EProjectFileState.SkippedNoRepository }
  }
  const tracked = await git(['ls-files', '--error-unmatch', '--', write.relativePath])
  if (tracked > 1) {
    return {
      path: write.path,
      state: EProjectFileState.Failed,
      reason: 'git could not check whether the path is tracked',
    }
  }
  if (tracked === 0) return { path: write.path, state: EProjectFileState.SkippedTracked }
  const ignored = await git(['check-ignore', '-q', '--', write.relativePath])
  if (ignored > 1) {
    return {
      path: write.path,
      state: EProjectFileState.Failed,
      reason: 'git could not check whether the path is ignored',
    }
  }
  const written = await writeOne({ files, write })
  if (written.state !== EProjectFileState.Written || ignored === 0) return written
  try {
    await excludeLocally({
      files,
      processes,
      root: write.root,
      relativePath: write.relativePath,
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    })
    return { path: write.path, state: EProjectFileState.WrittenLocallyExcluded }
  } catch (error) {
    return {
      path: write.path,
      state: EProjectFileState.WrittenNotExcluded,
      reason: messageOf(error),
    }
  }
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
  const outcomes: ProjectFileOutcome[] = [...plan.outcomes]
  for (const write of plan.writes) {
    if (!write.repository) {
      outcomes.push(await writeOne({ files: args.files, write }))
      continue
    }
    outcomes.push(
      await writeInRepository({
        files: args.files,
        processes: args.processes,
        write,
        ...(args.signal === undefined ? {} : { signal: args.signal }),
      }),
    )
  }
  return outcomes
}
