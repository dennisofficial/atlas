import { dirname, join } from 'node:path'

import { gitMessageOf, type GitRun } from '@dltech/atlas-harness'
import { githubCloneUrlOf, type ProjectRepo } from '@dltech/atlas-wire'

import type { WorkspaceFiles } from './workspace-files'

export type RepoGit = (args: { args: readonly string[]; cwd: string }) => Promise<GitRun>

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'it failed for a reason it did not name'

export const branchFlagsOf = (branch: string | null | undefined): string[] =>
  branch ? ['--branch', branch] : []

export const PARTIAL_CLONE_FLAG = '--filter=blob:none'

export const additionalRepoDirOf = (args: { cwd: string; repo: string }): string =>
  join(dirname(args.cwd), args.repo.split('/')[1] ?? args.repo)

const isBesideWorkspace = (args: { cwd: string; repo: string }): boolean => {
  const name = args.repo.split('/')[1] ?? ''
  if (name === '' || name === '.' || name === '..' || name.includes('/')) return false
  return dirname(additionalRepoDirOf(args)) === dirname(args.cwd)
}

export function validateAdditionalRepos(args: {
  cwd: string
  repos: readonly ProjectRepo[]
}): string | null {
  const targets = new Set<string>([args.cwd])
  for (const { repo } of args.repos) {
    if (!isBesideWorkspace({ cwd: args.cwd, repo }))
      return `${repo}: it cannot be cloned beside the workspace`
    const target = additionalRepoDirOf({ cwd: args.cwd, repo })
    if (targets.has(target)) return `${repo}: another repository already clones into ${target}`
    targets.add(target)
  }
  return null
}

export async function cloneAdditionalRepo(args: {
  git: RepoGit
  files: WorkspaceFiles
  cwd: string
  repo: ProjectRepo
  credentialed: (remoteUrl: string) => string
}): Promise<string | null> {
  const { git, files, cwd, credentialed } = args
  const { repo, branch } = args.repo
  const target = additionalRepoDirOf({ cwd, repo })
  const remoteUrl = githubCloneUrlOf(repo)
  try {
    await files.empty(target)
  } catch (error) {
    return messageOf(error)
  }
  const cloned = await git({
    args: [
      'clone',
      PARTIAL_CLONE_FLAG,
      ...branchFlagsOf(branch),
      '--',
      credentialed(remoteUrl),
      target,
    ],
    cwd: dirname(cwd),
  })
  if (!cloned.ok) {
    await files.empty(target).catch(() => undefined)
    return gitMessageOf(cloned)
  }

  const disarmed = await git({
    args: ['remote', 'set-url', 'origin', remoteUrl],
    cwd: target,
  })
  if (!disarmed.ok) {
    await files.empty(target).catch(() => undefined)
    return gitMessageOf(disarmed)
  }
  return null
}
