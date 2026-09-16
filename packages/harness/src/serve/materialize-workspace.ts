import { join } from 'node:path'

import { runGit, type GitRun } from '../workspace/run-git'

import { nodeWorkspaceFiles, type WorkspaceFiles } from './workspace-files'
import type { FetchWorkspaceSpec, WorkspaceSpec } from './workspace-spec'

export const WORKSPACE_SENTINEL = '.git/atlas-materialized'

const PATCH_FILE = '.git/atlas-workspace.patch'

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
  Checkout = 'checkout',
  Apply = 'apply',
  Sentinel = 'sentinel',
}

export type WorkspaceReadiness =
  | { state: EWorkspaceState.Present | EWorkspaceState.Materialized | EWorkspaceState.Skipped }
  | { state: EWorkspaceState.Failed; step: EWorkspaceStep; reason: string }

export type GitRunner = (args: { args: readonly string[]; cwd: string }) => Promise<GitRun>

export type EnsureWorkspace = (args: {
  cwd: string
  fetchSpec: FetchWorkspaceSpec
}) => Promise<WorkspaceReadiness>

const SSH_REMOTE = /^(?:ssh:\/\/)?git@([^/:]+)[:/](.+)$/

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'it failed for a reason it did not name'

const reasonOf = (run: GitRun): string => {
  const said = `${run.stderr}${run.stdout}`.trim()
  return said.length === 0 ? 'git said nothing and exited non-zero' : said
}

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

const checkoutArgsFor = (spec: WorkspaceSpec): readonly string[] | null => {
  if (spec.commit !== null) return ['checkout', '--detach', spec.commit]
  if (spec.branch !== null) return ['checkout', spec.branch]
  return null
}

/**
 * The commit is the truth and the branch only its name, so a detached head is the honest result: a
 * lifted session reproduces the tree the operator was looking at, uncommitted work included.
 */
export function createEnsureWorkspace(args: {
  git?: GitRunner | undefined
  files?: WorkspaceFiles | undefined
}): EnsureWorkspace {
  const git = args.git ?? runGit
  const files = args.files ?? nodeWorkspaceFiles

  return async ({ cwd, fetchSpec }) => {
    const sentinel = join(cwd, WORKSPACE_SENTINEL)
    if (await files.exists(sentinel)) return { state: EWorkspaceState.Present }

    let spec: WorkspaceSpec
    try {
      spec = await fetchSpec()
    } catch (error) {
      return failed(EWorkspaceStep.Fetch, messageOf(error))
    }

    const { remoteUrl, githubToken } = spec
    if (remoteUrl === null) return { state: EWorkspaceState.Skipped }

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

    const checkout = checkoutArgsFor(spec)
    if (checkout !== null) {
      const moved = await git({ args: checkout, cwd })
      if (!moved.ok) return failed(EWorkspaceStep.Checkout, scrub(reasonOf(moved)))
    }

    if (spec.patch.length > 0) {
      const patchPath = join(cwd, PATCH_FILE)
      try {
        await files.write({ path: patchPath, text: spec.patch })
      } catch (error) {
        return failed(EWorkspaceStep.Apply, messageOf(error))
      }
      const applied = await git({ args: ['apply', '--whitespace=nowarn', patchPath], cwd })
      if (!applied.ok) return failed(EWorkspaceStep.Apply, scrub(reasonOf(applied)))
    }

    try {
      await files.write({
        path: sentinel,
        text: JSON.stringify({ at: new Date().toISOString(), commit: spec.commit }),
      })
    } catch (error) {
      return failed(EWorkspaceStep.Sentinel, messageOf(error))
    }

    return { state: EWorkspaceState.Materialized }
  }
}

export const ensureWorkspace: EnsureWorkspace = createEnsureWorkspace({})

export function workspaceRefusalOf(readiness: WorkspaceReadiness): string | undefined {
  if (readiness.state !== EWorkspaceState.Failed) return undefined
  return `this sandbox has no workspace: ${readiness.step} failed — ${readiness.reason}`
}
