import { join } from 'node:path'

import { gitMessageOf, gitOneLine } from '../workspace/git-text'
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
  Baseline = 'baseline',
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

const checkoutArgsFor = (spec: WorkspaceSpec): readonly string[] | null => {
  if (spec.branch !== null && spec.commit !== null) {
    return ['checkout', '-B', spec.branch, spec.commit]
  }
  if (spec.branch !== null) return ['checkout', spec.branch]
  if (spec.commit !== null) return ['checkout', '--detach', spec.commit]
  return null
}

const patchedTreeOf = async (args: {
  git: GitRunner
  cwd: string
  scrub: (text: string) => string
}): Promise<{ tree: string | null } | { failure: WorkspaceReadiness }> => {
  const staged = await args.git({ args: ['add', '-A'], cwd: args.cwd })
  if (!staged.ok) return { failure: failed(EWorkspaceStep.Baseline, args.scrub(reasonOf(staged))) }
  const written = await args.git({ args: ['write-tree'], cwd: args.cwd })
  if (!written.ok) return { failure: failed(EWorkspaceStep.Baseline, args.scrub(reasonOf(written))) }
  const unstaged = await args.git({ args: ['reset'], cwd: args.cwd })
  if (!unstaged.ok) return { failure: failed(EWorkspaceStep.Baseline, args.scrub(reasonOf(unstaged))) }
  const tree = gitOneLine(written)
  if (tree === null) return { failure: failed(EWorkspaceStep.Baseline, 'the lifted tree has no id') }
  return { tree }
}

/**
 * A lifted session arrives on the branch the operator had checked out, at the commit they were
 * looking at, with their uncommitted work applied as uncommitted changes — git status reads
 * exactly like the machine they left. The sentinel records the branch tip as the baseline and the
 * tree WITH the lifted work applied as the baseline tree: the descend merges by content against
 * that tree, so no scratch commit ever sits in history inviting a rewrite, and a cloud edit
 * touching a lifted line merges against the same base the host will.
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

    const baseline = gitOneLine(await git({ args: ['rev-parse', '--verify', 'HEAD'], cwd }))

    let baselineTree = gitOneLine(await git({ args: ['rev-parse', '--verify', 'HEAD^{tree}'], cwd }))
    if (spec.patch.length > 0) {
      const patchPath = join(cwd, PATCH_FILE)
      try {
        await files.write({ path: patchPath, text: spec.patch })
      } catch (error) {
        return failed(EWorkspaceStep.Apply, messageOf(error))
      }
      const applied = await git({ args: ['apply', '--whitespace=nowarn', patchPath], cwd })
      if (!applied.ok) return failed(EWorkspaceStep.Apply, scrub(reasonOf(applied)))

      const patched = await patchedTreeOf({ git, cwd, scrub })
      if ('failure' in patched) return patched.failure
      baselineTree = patched.tree
    }

    try {
      await files.write({
        path: sentinel,
        text: JSON.stringify({
          at: new Date().toISOString(),
          commit: spec.commit,
          baseline,
          baselineTree,
          branch: spec.branch,
        }),
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
