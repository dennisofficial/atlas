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
import { uncarriedWork } from './uncarried-work'
import type { FetchWorkspaceSpec, WorkspaceSpec } from './workspace-spec'

export type PublishedWorkspace = {
  ref: string
  commit: string
  base: string | null
  baseTree: string | null
  branch: string | null
}

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

type LiftRecord = {
  baseline: string | null
  baselineTree: string | null
  branch: string | null
}

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

const sentinelOf = async (cwd: string): Promise<Partial<LiftRecord>> => {
  try {
    const sentinel: unknown = JSON.parse(await readFile(join(cwd, WORKSPACE_SENTINEL), 'utf8'))
    if (typeof sentinel !== 'object' || sentinel === null) return {}
    const record = sentinel as Record<string, unknown>
    return {
      baseline: stringOrNull(record.baseline),
      baselineTree: stringOrNull(record.baselineTree),
      branch: stringOrNull(record.branch),
    }
  } catch {
    return {}
  }
}

const treeOfCommit = async (args: {
  git: GitRunner
  cwd: string
  commit: string
}): Promise<string | null> =>
  gitOneLine(await args.git({ args: ['rev-parse', '--verify', `${args.commit}^{tree}`], cwd: args.cwd }))

const liftRecordOf = async (args: {
  git: GitRunner
  cwd: string
  spec: WorkspaceSpec
}): Promise<LiftRecord> => {
  const sentinel = await sentinelOf(args.cwd)
  const baseline = sentinel.baseline ?? args.spec.commit
  const baselineTree =
    sentinel.baselineTree ??
    (baseline === null ? null : await treeOfCommit({ git: args.git, cwd: args.cwd, commit: baseline }))
  return { baseline, baselineTree, branch: sentinel.branch ?? args.spec.branch }
}

/**
 * The descend half of the workspace move: whatever the sandbox tree holds beyond the baseline the
 * materialization recorded — edits the agent never committed, commits it made — goes home as one
 * commit on a scratch ref the operator's machine then fetches and merges. The ref names its own
 * commit, so a thread that descends twice never needs force to push again.
 *
 * Only HEAD rides. A side branch or nested worktree reads as an untouched checkout from here, so
 * their existence refuses the publish outright — the alternative is the descend reporting success
 * while that work dies with the sandbox.
 *
 * The pushed commit carries the recorded baseline tree as a second parent: the host merges by
 * content against that tree, and a second parent is the one way to guarantee the tree object
 * travels with the fetch — the descend ref's own ancestry never contains it.
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

    const record = await liftRecordOf({ git, cwd, spec })
    const baseline = record.baseline
    const dirty = await hasUncommittedWork({ git, cwd })
    const before = await headOf({ git, cwd })

    if (before !== null) {
      const uncarried = await uncarriedWork({ git, cwd })
      if (uncarried.length > 0) {
        throw new Error(
          `the sandbox holds work a descend cannot carry: ${uncarried.join('; ')}. Nothing was sent home — push it from the sandbox or fold it into the checked-out branch, then descend again.`,
        )
      }
    }

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

    const head = await headOf({ git, cwd })
    if (head === null) throw new Error('the workspace has no commit to send home')

    const tree = gitOneLine(await git({ args: ['rev-parse', '--verify', 'HEAD^{tree}'], cwd }))
    if (tree === null) throw new Error('the workspace has no tree to send home')

    let baseCommit: string | null = null
    if (record.baselineTree !== null) {
      baseCommit = gitOneLine(
        await git({
          args: [
            ...ATLAS_GIT_IDENTITY,
            'commit-tree',
            record.baselineTree,
            '-m',
            'atlas: lift baseline',
          ],
          cwd,
        }),
      )
    } else if (record.baseline !== null) {
      baseCommit = record.baseline
    }

    const parents = [head, ...(baseCommit === null ? [] : [baseCommit])]
    const commit = gitOneLine(
      await git({
        args: [
          ...ATLAS_GIT_IDENTITY,
          'commit-tree',
          tree,
          ...parents.flatMap((parent) => ['-p', parent]),
          '-m',
          'atlas: workspace coming home',
        ],
        cwd,
      }),
    )
    if (commit === null) throw new Error('the workspace tree would not commit for the push home')

    const ref = `refs/atlas/descend/${args.threadId}-${commit.slice(0, 12)}`
    const pushed = await git({
      args: [
        'push',
        '--',
        credentialedRemoteOf({ remoteUrl: spec.remoteUrl, token: spec.githubToken }),
        `${commit}:${ref}`,
      ],
      cwd,
    })
    if (!pushed.ok) {
      throw new Error(`the workspace would not push home: ${scrub(gitMessageOf(pushed))}`)
    }

    return { ref, commit, base: baseline, baseTree: record.baselineTree, branch: record.branch }
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
