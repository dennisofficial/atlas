import { dirname, join } from 'node:path'

import {
  EWorkspaceRepoState,
  type FileSystemPort,
  type WorkspaceStepRepo,
} from '@dltech/atlas-core'
import type { WorkspaceConfig } from '../config/agent-host-config'
import { githubCloneUrlOf } from '../sandbox/constants'

import { branchFlagsOf, CLONE_TIMEOUT_MS, run } from './workspace-git'
import { repoOfRemoteUrl, type RepoProgress } from './workspace-repos'
import {
  additionalSentinelOf,
  exists,
  fail,
  report,
  writeSentinel,
  type Deps,
} from './workspace-state'

type AdditionalRepo = WorkspaceConfig['additionalRepos'][number]

const REASON_TAIL_CHARS = 500

export const EARLIER_CLONE_FAILURE = 'not cloned: the clone failed on an earlier start'
export const PRIMARY_CLONE_FAILURE = 'stopped: the primary repo failed to clone'

const additionalRepoDirOf = (args: { launchDirectory: string; repo: string }): string =>
  join(dirname(args.launchDirectory), args.repo.split('/')[1] ?? args.repo)

const reasonOf = (detail: string): string =>
  detail.trim().slice(-REASON_TAIL_CHARS) || 'git clone failed without output'

type CloneArgs = {
  deps: Deps
  credentialFlags: readonly string[]
  launchDirectory: string
  stateDir: string
  progress: RepoProgress
  scrub: (text: string) => string
  primaryFailed: AbortSignal
}

const cloneOne = async (args: CloneArgs & { entry: AdditionalRepo; signal: AbortSignal }) => {
  const { deps, progress } = args
  const { repo, branch } = args.entry
  const target = additionalRepoDirOf({ launchDirectory: args.launchDirectory, repo })
  const marker = additionalSentinelOf({ stateDir: args.stateDir, repo })
  try {
    if (await exists({ files: deps.files, path: marker })) {
      progress.set({ repo, state: EWorkspaceRepoState.Done })
      return
    }
    progress.set({ repo, state: EWorkspaceRepoState.Cloning })
    await deps.files.removeFile({ path: target })
    const cloned = await run({
      processes: deps.processes,
      cmd: [
        'git',
        ...args.credentialFlags,
        'clone',
        '--filter=blob:none',
        ...branchFlagsOf(branch ?? null),
        '--',
        githubCloneUrlOf(repo),
        target,
      ],
      cwd: dirname(args.launchDirectory),
      timeoutMs: CLONE_TIMEOUT_MS,
      signal: args.signal,
    })
    if (!cloned.ok) {
      await deps.files.removeFile({ path: target }).catch(() => undefined)
      if (args.primaryFailed.aborted) {
        progress.set({ repo, state: EWorkspaceRepoState.Failed, reason: PRIMARY_CLONE_FAILURE })
        return
      }
      const detail = args.scrub(cloned.output)
      const message = `additional repo ${repo} clone failed, so ${target} is missing`
      report({ deps, message, detail })
      fail({ deps, message, detail })
      progress.set({ repo, state: EWorkspaceRepoState.Failed, reason: reasonOf(detail) })
      return
    }
    const marked = await writeSentinel({
      deps,
      path: marker,
      message: `additional repo ${repo} marker write failed`,
    })
    progress.set({
      repo,
      state: marked ? EWorkspaceRepoState.Done : EWorkspaceRepoState.Failed,
      ...(marked ? {} : { reason: 'its clone marker could not be written' }),
    })
  } catch (error) {
    const detail = args.scrub(String(error))
    fail({ deps, message: `additional repo ${repo} clone failed, so ${target} is missing`, detail })
    progress.set({ repo, state: EWorkspaceRepoState.Failed, reason: reasonOf(detail) })
  }
}

export const cloneAdditionalRepos = async (
  args: CloneArgs & { repos: WorkspaceConfig['additionalRepos'] },
): Promise<void> => {
  const signal =
    args.deps.signal === undefined
      ? args.primaryFailed
      : AbortSignal.any([args.deps.signal, args.primaryFailed])
  await Promise.all(args.repos.map((entry) => cloneOne({ ...args, entry, signal })))
}

export const replayedReposOf = async (args: {
  files: FileSystemPort
  workspace: WorkspaceConfig
  launchDirectory: string
}): Promise<WorkspaceStepRepo[]> => {
  const { workspace } = args
  const primary =
    workspace.remoteUrl === null
      ? []
      : [{ repo: repoOfRemoteUrl(workspace.remoteUrl), state: EWorkspaceRepoState.Done }]
  const additional = await Promise.all(
    workspace.additionalRepos.map(async ({ repo }): Promise<WorkspaceStepRepo> => {
      const path = additionalRepoDirOf({ launchDirectory: args.launchDirectory, repo })
      return (await exists({ files: args.files, path }))
        ? { repo, state: EWorkspaceRepoState.Done }
        : { repo, state: EWorkspaceRepoState.Failed, reason: EARLIER_CLONE_FAILURE }
    }),
  )
  return [...primary, ...additional]
}
