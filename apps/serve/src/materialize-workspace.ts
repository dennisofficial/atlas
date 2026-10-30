import { join } from 'node:path'

import { gitMessageOf, gitOneLine } from '@dltech/atlas-harness'
import { runGit, type GitRun } from '@dltech/atlas-harness'

import { EBootStepState, MAX_BOOT_STEP_TEXT, type CloneRepoProgress } from '@dltech/atlas-wire'

import {
  branchFlagsOf,
  cloneAdditionalRepo,
  PARTIAL_CLONE_FLAG,
  validateAdditionalRepos,
} from './clone-repo'
import type { ApplyEnvironmentProfile, EnvironmentProfile } from './environment-profile'
import { nodeWorkspaceFiles, type WorkspaceFiles } from './workspace-files'
import type { FetchWorkspaceSpec, WorkspaceSpec } from './workspace-spec'

export const WORKSPACE_SENTINEL = '.git/atlas-materialized'

export enum EWorkspaceState {
  Present = 'present',
  Materialized = 'materialized',
  Skipped = 'skipped',
  Failed = 'failed',
}

export enum EWorkspaceStep {
  Fetch = 'fetch',
  Clear = 'clear',
  Clone = 'clone',
  Sentinel = 'sentinel',
}

export type WorkspaceReadiness =
  | {
      state: EWorkspaceState.Present | EWorkspaceState.Skipped
      profile?: EnvironmentProfile | undefined
    }
  | {
      state: EWorkspaceState.Materialized
      profile?: EnvironmentProfile | undefined
      repos?: CloneRepoProgress[] | undefined
    }
  | {
      state: EWorkspaceState.Failed
      step: EWorkspaceStep
      reason: string
      repos?: CloneRepoProgress[] | undefined
    }

export type GitRunner = (args: { args: readonly string[]; cwd: string }) => Promise<GitRun>

export type EnsureWorkspace = (args: {
  cwd: string
  fetchSpec: FetchWorkspaceSpec
  progress?: ((repos: CloneRepoProgress[]) => void) | undefined
}) => Promise<WorkspaceReadiness>

const SSH_REMOTE = /^(?:ssh:\/\/)?git@([^/:]+)[:/](.+)$/

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'it failed for a reason it did not name'

const reasonOf = (run: GitRun): string => gitMessageOf(run)

const failed = (
  step: EWorkspaceStep,
  reason: string,
  repos?: CloneRepoProgress[],
): WorkspaceReadiness => ({
  state: EWorkspaceState.Failed,
  step,
  reason,
  ...(repos === undefined ? {} : { repos }),
})

const repoNameOf = (remoteUrl: string): string => {
  try {
    const path = new URL(httpsRemoteOf(remoteUrl)).pathname
    return path
      .replace(/^\/+/, '')
      .replace(/\.git$/, '')
      .replace(/\/+$/, '')
  } catch {
    return 'primary'
  }
}

const truncated = (text: string): string => text.slice(0, MAX_BOOT_STEP_TEXT)

export function httpsRemoteOf(remoteUrl: string): string {
  const ssh = SSH_REMOTE.exec(remoteUrl)
  if (ssh === null) return remoteUrl
  return `https://${ssh[1]}/${ssh[2]}`
}

export function credentialedRemoteOf(args: { remoteUrl: string; token: string | null }): string {
  const https = httpsRemoteOf(args.remoteUrl)
  if (args.token === null || !https.startsWith('https://')) return args.remoteUrl
  return https.replace('https://', `https://x-access-token:${args.token}@`)
}

export function createEnsureWorkspace(args: {
  git?: GitRunner | undefined
  files?: WorkspaceFiles | undefined
  profile?: ApplyEnvironmentProfile | undefined
}): EnsureWorkspace {
  const git = args.git ?? runGit
  const files = args.files ?? nodeWorkspaceFiles

  return async ({ cwd, fetchSpec, progress }) => {
    const applyProfile = async (spec: WorkspaceSpec): Promise<EnvironmentProfile | undefined> => {
      if (args.profile === undefined) return undefined
      try {
        return await args.profile({ cwd, spec })
      } catch {
        return undefined
      }
    }

    const sentinel = join(cwd, WORKSPACE_SENTINEL)
    if (await files.exists(sentinel)) {
      if (args.profile === undefined) return { state: EWorkspaceState.Present }
      try {
        const spec = await fetchSpec()
        return {
          state: EWorkspaceState.Present,
          profile: await args.profile({ cwd, spec }),
        }
      } catch {
        return { state: EWorkspaceState.Present }
      }
    }

    let spec: WorkspaceSpec
    try {
      spec = await fetchSpec()
    } catch (error) {
      return failed(EWorkspaceStep.Fetch, messageOf(error))
    }

    const { remoteUrl, githubToken, baseBranch, additionalRepos } = spec
    if (remoteUrl === null) {
      try {
        await files.ensureDirectory(cwd)
      } catch (error) {
        return failed(EWorkspaceStep.Clear, messageOf(error))
      }
      return {
        state: EWorkspaceState.Skipped,
        profile: await applyProfile(spec),
      }
    }

    const scrub = (text: string): string =>
      githubToken === null ? text : text.split(githubToken).join('***')

    const extras = additionalRepos ?? []
    const invalid = validateAdditionalRepos({ cwd, repos: extras })
    if (invalid !== null) return failed(EWorkspaceStep.Clone, scrub(invalid))

    try {
      await files.empty(cwd)
    } catch (error) {
      return failed(EWorkspaceStep.Clear, messageOf(error))
    }

    const repos: CloneRepoProgress[] = [
      { repo: repoNameOf(remoteUrl), state: EBootStepState.Running },
      ...extras.map(({ repo }) => ({ repo, state: EBootStepState.Running })),
    ]
    const settle = (index: number, failure: string | null): string | null => {
      const row = repos[index]
      if (row === undefined) return failure
      repos[index] =
        failure === null
          ? { repo: row.repo, state: EBootStepState.Done }
          : {
              repo: row.repo,
              state: EBootStepState.Error,
              error: truncated(scrub(failure)),
            }
      progress?.(repos.map((one) => ({ ...one })))
      return failure
    }
    progress?.(repos.map((one) => ({ ...one })))

    const clonePrimary = async (): Promise<string | null> => {
      const cloned = await git({
        args: [
          'clone',
          PARTIAL_CLONE_FLAG,
          ...branchFlagsOf(baseBranch),
          '--',
          credentialedRemoteOf({ remoteUrl, token: githubToken }),
          '.',
        ],
        cwd,
      })
      if (!cloned.ok) return reasonOf(cloned)
      const disarmed = await git({
        args: ['remote', 'set-url', 'origin', httpsRemoteOf(remoteUrl)],
        cwd,
      })
      return disarmed.ok ? null : reasonOf(disarmed)
    }

    const [primaryFailure] = await Promise.all([
      clonePrimary()
        .catch((error: unknown) => messageOf(error))
        .then((failure) => settle(0, failure)),
      ...extras.map((repo, index) =>
        cloneAdditionalRepo({
          git,
          files,
          cwd,
          repo,
          credentialed: (extraUrl) =>
            credentialedRemoteOf({ remoteUrl: extraUrl, token: githubToken }),
        })
          .catch((error: unknown) => messageOf(error))
          .then((failure) => settle(index + 1, failure)),
      ),
    ])
    if (primaryFailure !== null) return failed(EWorkspaceStep.Clone, scrub(primaryFailure), repos)

    const commit = gitOneLine(await git({ args: ['rev-parse', '--verify', 'HEAD'], cwd }))

    try {
      await files.write({
        path: sentinel,
        text: JSON.stringify({ at: new Date().toISOString(), commit }),
      })
    } catch (error) {
      return failed(EWorkspaceStep.Sentinel, messageOf(error))
    }

    return {
      state: EWorkspaceState.Materialized,
      profile: await applyProfile(spec),
      repos,
    }
  }
}

export const ensureWorkspace: EnsureWorkspace = createEnsureWorkspace({})

export function workspaceRefusalOf(readiness: WorkspaceReadiness): string | undefined {
  if (readiness.state !== EWorkspaceState.Failed) return undefined
  return `this sandbox has no workspace: ${readiness.step} failed — ${readiness.reason}`
}
