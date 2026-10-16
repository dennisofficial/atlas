import { join } from 'node:path'

import { gitMessageOf, gitOneLine } from '@dltech/atlas-harness'
import { runGit, type GitRun } from '@dltech/atlas-harness'

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
      state: EWorkspaceState.Present | EWorkspaceState.Materialized | EWorkspaceState.Skipped
      profile?: EnvironmentProfile | undefined
    }
  | { state: EWorkspaceState.Failed; step: EWorkspaceStep; reason: string }

export type GitRunner = (args: { args: readonly string[]; cwd: string }) => Promise<GitRun>

export type EnsureWorkspace = (args: {
  cwd: string
  fetchSpec: FetchWorkspaceSpec
}) => Promise<WorkspaceReadiness>

const SSH_REMOTE = /^(?:ssh:\/\/)?git@([^/:]+)[:/](.+)$/

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'it failed for a reason it did not name'

const reasonOf = (run: GitRun): string => gitMessageOf(run)

const failed = (step: EWorkspaceStep, reason: string): WorkspaceReadiness => ({
  state: EWorkspaceState.Failed,
  step,
  reason,
})

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

/**
 * A cloud-born sandbox starts from what origin says right now: a full clone of the repo's default
 * branch, credentialed by the brokered githubToken, with the token scrubbed from the remote once
 * the clone lands. The sentinel records the clone's HEAD; its presence is the "already
 * materialized" answer on a resumed boot.
 */
export function createEnsureWorkspace(args: {
  git?: GitRunner | undefined
  files?: WorkspaceFiles | undefined
  profile?: ApplyEnvironmentProfile | undefined
}): EnsureWorkspace {
  const git = args.git ?? runGit
  const files = args.files ?? nodeWorkspaceFiles

  return async ({ cwd, fetchSpec }) => {
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
        return { state: EWorkspaceState.Present, profile: await args.profile({ cwd, spec }) }
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

    const { remoteUrl, githubToken } = spec
    if (remoteUrl === null) {
      try {
        await files.ensureDirectory(cwd)
      } catch (error) {
        return failed(EWorkspaceStep.Clear, messageOf(error))
      }
      return { state: EWorkspaceState.Skipped, profile: await applyProfile(spec) }
    }

    const scrub = (text: string): string =>
      githubToken === null ? text : text.split(githubToken).join('***')

    try {
      await files.empty(cwd)
    } catch (error) {
      return failed(EWorkspaceStep.Clear, messageOf(error))
    }

    const cloned = await git({
      args: ['clone', '--', credentialedRemoteOf({ remoteUrl, token: githubToken }), '.'],
      cwd,
    })
    if (!cloned.ok) return failed(EWorkspaceStep.Clone, scrub(reasonOf(cloned)))

    const disarmed = await git({
      args: ['remote', 'set-url', 'origin', httpsRemoteOf(remoteUrl)],
      cwd,
    })
    if (!disarmed.ok) return failed(EWorkspaceStep.Clone, scrub(reasonOf(disarmed)))

    const commit = gitOneLine(await git({ args: ['rev-parse', '--verify', 'HEAD'], cwd }))

    try {
      await files.write({
        path: sentinel,
        text: JSON.stringify({ at: new Date().toISOString(), commit }),
      })
    } catch (error) {
      return failed(EWorkspaceStep.Sentinel, messageOf(error))
    }

    return { state: EWorkspaceState.Materialized, profile: await applyProfile(spec) }
  }
}

export const ensureWorkspace: EnsureWorkspace = createEnsureWorkspace({})

export function workspaceRefusalOf(readiness: WorkspaceReadiness): string | undefined {
  if (readiness.state !== EWorkspaceState.Failed) return undefined
  return `this sandbox has no workspace: ${readiness.step} failed — ${readiness.reason}`
}
