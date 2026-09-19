import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ThreadId } from '@dltech/atlas-core'

import { ATLAS_GIT_IDENTITY, gitMessageOf, gitOneLine } from '../workspace/git-text'
import { runGit, type GitRun } from '../workspace/run-git'

import {
  credentialedRemoteOf,
  EWorkspaceState,
  WORKSPACE_SENTINEL,
  type GitRunner,
  type WorkspaceReadiness,
} from './materialize-workspace'
import type { FetchWorkspaceSpec, WorkspaceSpec } from './workspace-spec'

export type PublishedWorkspace = { ref: string; commit: string; base: string | null }

export type PublishWorkspace = (args: { cwd: string }) => Promise<PublishedWorkspace | null>

/** The publisher with its workspace bound — what the session layer answers requests with. */
export type WorkspacePublisher = () => Promise<PublishedWorkspace | null>

const demand = (args: { run: GitRun; scrub: (text: string) => string }): GitRun => {
  if (args.run.ok) return args.run
  throw new Error(args.scrub(gitMessageOf(args.run)))
}

const headOf = async (args: { git: GitRunner; cwd: string }): Promise<string | null> =>
  gitOneLine(await args.git({ args: ['rev-parse', '--verify', 'HEAD'], cwd: args.cwd }))

const hasUncommittedWork = async (args: { git: GitRunner; cwd: string }): Promise<boolean> => {
  const staged = await args.git({ args: ['diff', '--cached', '--name-only'], cwd: args.cwd })
  return staged.ok && staged.stdout.trim().length > 0
}

const untouchedSinceLift = (args: {
  head: string | null
  baseline: string | null
}): boolean => {
  if (args.baseline !== null) return args.head === args.baseline
  return args.head === null
}

const baselineOf = async (args: {
  cwd: string
  spec: WorkspaceSpec
}): Promise<string | null> => {
  try {
    const sentinel: unknown = JSON.parse(await readFile(join(args.cwd, WORKSPACE_SENTINEL), 'utf8'))
    if (
      typeof sentinel === 'object' &&
      sentinel !== null &&
      'baseline' in sentinel &&
      typeof sentinel.baseline === 'string'
    ) {
      return sentinel.baseline
    }
  } catch {
    // no sentinel — a workspace materialized before baselines existed; the lifted commit stands in
  }
  return args.spec.commit
}

/**
 * The descend half of the workspace move: whatever the sandbox tree holds beyond the baseline the
 * materialization recorded — edits the agent never committed, commits it made — goes home as one
 * commit on a scratch ref the operator's machine then fetches and merges. The ref names its own
 * commit, so a thread that descends twice never needs force to push again.
 */
export function createWorkspacePublisher(args: {
  threadId: ThreadId
  fetchSpec: FetchWorkspaceSpec
  git?: GitRunner | undefined
}): PublishWorkspace {
  const git = args.git ?? runGit

  return async ({ cwd }) => {
    const spec = await args.fetchSpec()
    if (spec.remoteUrl === null) return null

    const scrub = (text: string): string =>
      spec.githubToken === null ? text : text.split(spec.githubToken).join('***')

    demand({ run: await git({ args: ['add', '-A'], cwd }), scrub })

    const baseline = await baselineOf({ cwd, spec })
    const dirty = await hasUncommittedWork({ git, cwd })
    const before = await headOf({ git, cwd })
    if (!dirty && untouchedSinceLift({ head: before, baseline })) return null

    if (dirty) {
      demand({
        run: await git({
          args: [...ATLAS_GIT_IDENTITY, 'commit', '-m', 'atlas: workspace coming home'],
          cwd,
        }),
        scrub,
      })
    }

    const commit = await headOf({ git, cwd })
    if (commit === null) throw new Error('the workspace has no commit to send home')

    const ref = `refs/atlas/descend/${args.threadId}-${commit.slice(0, 12)}`
    const pushed = await git({
      args: [
        'push',
        '--',
        credentialedRemoteOf({ remoteUrl: spec.remoteUrl, token: spec.githubToken }),
        `HEAD:${ref}`,
      ],
      cwd,
    })
    if (!pushed.ok) {
      throw new Error(`the workspace would not push home: ${scrub(gitMessageOf(pushed))}`)
    }

    return { ref, commit, base: baseline }
  }
}

/**
 * The publisher a booted serve answers with: real when the workspace materialized (or survived a
 * restart), a nothing-to-send answer otherwise.
 */
export function workspacePublisherFor(args: {
  workspace: WorkspaceReadiness
  threadId: ThreadId
  fetchSpec: FetchWorkspaceSpec
  cwd: string
}): WorkspacePublisher {
  const usable =
    args.workspace.state === EWorkspaceState.Materialized ||
    args.workspace.state === EWorkspaceState.Present
  if (!usable) return async () => null

  const publish = createWorkspacePublisher({ threadId: args.threadId, fetchSpec: args.fetchSpec })
  return () => publish({ cwd: args.cwd })
}
