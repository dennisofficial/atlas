import { dirname, join } from 'node:path'

import { gitMessageOf, type GitRun } from '@dltech/atlas-harness'
import { githubCloneUrlOf, type ProjectRepo } from '@dltech/atlas-wire'

import type { WorkspaceFiles } from './workspace-files'

export type RepoGit = (args: { args: readonly string[]; cwd: string }) => Promise<GitRun>

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'it failed for a reason it did not name'

export const branchFlagsOf = (branch: string | null | undefined): string[] =>
  branch ? ['--branch', branch] : []

export const additionalRepoDirOf = (args: { cwd: string; repo: string }): string =>
  join(dirname(args.cwd), args.repo.split('/')[1] ?? args.repo)

const isBesideWorkspace = (args: { cwd: string; repo: string }): boolean => {
  const name = args.repo.split('/')[1] ?? ''
  if (name === '' || name === '.' || name === '..' || name.includes('/')) return false
  return dirname(additionalRepoDirOf(args)) === dirname(args.cwd)
}

export async function cloneAdditionalRepos(args: {
  git: RepoGit
  files: WorkspaceFiles
  cwd: string
  repos: readonly ProjectRepo[]
  credentialed: (remoteUrl: string) => string
}): Promise<string | null> {
  const { git, files, cwd, credentialed } = args
  for (const { repo, branch } of args.repos) {
    if (!isBesideWorkspace({ cwd, repo }))
      return `${repo}: it cannot be cloned beside the workspace`
    const target = additionalRepoDirOf({ cwd, repo })

    const remoteUrl = githubCloneUrlOf(repo)
    try {
      await files.empty(target)
    } catch (error) {
      return `${repo}: ${messageOf(error)}`
    }
    const cloned = await git({
      args: ['clone', ...branchFlagsOf(branch), '--', credentialed(remoteUrl), target],
      cwd: dirname(cwd),
    })
    if (!cloned.ok) {
      await files.empty(target).catch(() => undefined)
      return `${repo}: ${gitMessageOf(cloned)}`
    }

    const disarmed = await git({ args: ['remote', 'set-url', 'origin', remoteUrl], cwd: target })
    if (!disarmed.ok) {
      await files.empty(target).catch(() => undefined)
      return `${repo}: ${gitMessageOf(disarmed)}`
    }
  }
  return null
}
