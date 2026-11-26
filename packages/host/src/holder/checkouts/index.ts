import { join } from 'node:path'

import { CallInterruptedError, type FileSystemPort, type ProcessPort } from '@dltech/atlas-core'
import type {
  PodWorktrees,
  WorktreeEntryInfo,
  WorktreeListing,
  WorktreeRemoval,
  WorktreeState,
} from '@dltech/atlas-plugin-sdk'

import { DaemonFileSystemPort } from '../../calls/ports/filesystem'
import { DaemonProcessPort } from '../../calls/ports/process'
import type { RemoteCalls } from '../../calls/remote-calls'
import { POD_WAIT_INTERRUPTED, type WorkspaceGate } from '../../calls/workspace-gate'
import { complaintOf, runGit } from './git'
import { parseStatus, parseWorktrees } from './parse'

const WORKTREE_HOME = '.atlas/worktrees'
const ORIGIN = 'origin'
const ORIGIN_PREFIX = `${ORIGIN}/`
const CANDIDATE_BRANCHES = ['main', 'master'] as const
const CHANGED_PATH_SAMPLE = 5

type Base = { ref: string; fromOrigin: boolean }

const awaitWorkspace = async (gate: WorkspaceGate | undefined): Promise<void> => {
  if (gate === undefined) return
  const outcome = await gate.wait()
  if (outcome.state === 'prepared') return
  if (outcome.state === 'failed') throw new Error(outcome.message)
  throw new CallInterruptedError({ message: POD_WAIT_INTERRUPTED })
}

export class HostWorktrees implements PodWorktrees {
  constructor(
    private readonly args: {
      processes: ProcessPort
      files: FileSystemPort
      gate?: WorkspaceGate | undefined
    },
  ) {}

  async list(args: { cwd: string }): Promise<WorktreeListing> {
    const run = await this.git(args.cwd, ['worktree', 'list', '--porcelain'])
    if (!run.ok) {
      throw new Error(
        `${args.cwd} is not inside a git repository, so there is nothing to branch from`,
      )
    }
    const worktrees = parseWorktrees({ output: run.stdout })
    const main = worktrees.find((worktree) => worktree.isMain)
    if (main === undefined) {
      throw new Error(`git listed no main worktree for the repository at ${args.cwd}`)
    }
    return { repository: main.path, worktrees }
  }

  async create(args: { cwd: string; name: string }): Promise<WorktreeEntryInfo> {
    const { repository, worktrees } = await this.list({ cwd: args.cwd })
    const home = join(repository, WORKTREE_HOME)
    const path = join(home, args.name)
    const existing = worktrees.find((worktree) => worktree.path === path)
    if (existing !== undefined) {
      return await this.existingOf({
        repository,
        path,
        name: args.name,
        branch: existing.branch ?? undefined,
      })
    }
    await this.args.files.mkdir({ path: home })
    await this.args.files.writeFile({ path: join(home, '.gitignore'), content: '*\n' })
    const fetched = await this.git(repository, ['fetch', ORIGIN])
    const base = await this.baseOf(repository)
    const added = await this.git(repository, ['worktree', 'add', path, '-b', args.name, base.ref])
    if (!added.ok) throw new Error(complaintOf(added))
    return { path, branch: args.name, base: base.ref, staleBase: base.fromOrigin && !fetched.ok }
  }

  private async existingOf(args: {
    repository: string
    path: string
    name: string
    branch: string | undefined
  }): Promise<WorktreeEntryInfo> {
    if (args.branch !== args.name) {
      throw new Error(
        `a worktree already exists at ${args.path} on ${args.branch ?? 'a detached head'}, not ${args.name}`,
      )
    }
    const base = await this.baseOf(args.repository)
    return { path: args.path, branch: args.name, base: base.ref }
  }

  async inspect(args: { cwd: string; base?: string | undefined }): Promise<WorktreeState> {
    const status = await this.git(args.cwd, ['status', '--porcelain'])
    const changed = status.ok ? parseStatus({ output: status.stdout }) : []
    const upstream = await this.upstreamOf(args.cwd)
    const unpushed = await this.unpushedOf({ cwd: args.cwd, upstream, base: args.base })
    const behind =
      upstream === undefined
        ? undefined
        : ((await this.count(args.cwd, `HEAD..${upstream}`)) ?? undefined)
    return {
      isClean: changed.length === 0 && unpushed !== null && unpushed.count === 0,
      changedPaths: changed.slice(0, CHANGED_PATH_SAMPLE),
      changedCount: changed.length,
      unpushed,
      upstream,
      base: args.base,
      behind,
    }
  }

  async remove(args: {
    cwd: string
    path: string
    branch?: string | undefined
    force: boolean
  }): Promise<WorktreeRemoval> {
    const checkedOut = await this.branchOf(args.path)
    if (args.branch !== undefined && checkedOut !== undefined && args.branch !== checkedOut) {
      throw new Error(
        `the worktree at ${args.path} is on ${checkedOut}, not ${args.branch}; nothing was removed`,
      )
    }
    const argv = args.force
      ? ['worktree', 'remove', '--force', args.path]
      : ['worktree', 'remove', args.path]
    const removed = await this.git(args.cwd, argv)
    const branch = args.branch ?? checkedOut
    if (!removed.ok) {
      if (await this.stillWorktree({ cwd: args.cwd, path: args.path })) {
        throw new Error(complaintOf(removed))
      }
      return await this.branchSettledOf({ cwd: args.cwd, branch })
    }
    if (branch === undefined) return { branch: undefined, branchDeleted: undefined }
    const deleted = await this.git(args.cwd, ['branch', '-D', branch])
    return { branch, branchDeleted: deleted.ok }
  }

  private async stillWorktree(args: { cwd: string; path: string }): Promise<boolean> {
    const run = await this.git(args.cwd, ['worktree', 'list', '--porcelain'])
    if (!run.ok) return true
    return parseWorktrees({ output: run.stdout }).some((worktree) => worktree.path === args.path)
  }

  private async branchSettledOf(args: {
    cwd: string
    branch: string | undefined
  }): Promise<WorktreeRemoval> {
    if (args.branch === undefined) return { branch: undefined, branchDeleted: undefined }
    if (!(await this.resolves(args.cwd, `refs/heads/${args.branch}`))) {
      return { branch: args.branch, branchDeleted: true }
    }
    const deleted = await this.git(args.cwd, ['branch', '-D', args.branch])
    return { branch: args.branch, branchDeleted: deleted.ok }
  }

  private async branchOf(cwd: string): Promise<string | undefined> {
    const run = await this.git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const name = run.stdout.trim()
    return run.ok && name.length > 0 && name !== 'HEAD' ? name : undefined
  }

  private async unpushedOf(args: {
    cwd: string
    upstream: string | undefined
    base: string | undefined
  }): Promise<WorktreeState['unpushed']> {
    if (args.upstream !== undefined) return await this.unpushedAgainst(args.cwd, args.upstream)
    if (args.base === undefined) return null
    return await this.unpushedAgainst(args.cwd, args.base)
  }

  private async unpushedAgainst(cwd: string, against: string): Promise<WorktreeState['unpushed']> {
    const count = await this.count(cwd, `${against}..HEAD`)
    return count === null ? null : { count, against }
  }

  private async baseOf(cwd: string): Promise<Base> {
    const head = await this.git(cwd, [
      'symbolic-ref',
      '--quiet',
      '--short',
      'refs/remotes/origin/HEAD',
    ])
    const named = head.stdout.trim()
    if (head.ok && named.length > 0) {
      const branch = named.startsWith(ORIGIN_PREFIX) ? named.slice(ORIGIN_PREFIX.length) : named
      return { ref: `${ORIGIN_PREFIX}${branch}`, fromOrigin: true }
    }
    for (const branch of CANDIDATE_BRANCHES) {
      if (await this.resolves(cwd, `${ORIGIN_PREFIX}${branch}`)) {
        return { ref: `${ORIGIN_PREFIX}${branch}`, fromOrigin: true }
      }
    }
    for (const branch of CANDIDATE_BRANCHES) {
      if (await this.resolves(cwd, `refs/heads/${branch}`)) {
        return { ref: branch, fromOrigin: false }
      }
    }
    throw new Error(
      'could not determine a default branch: no origin/HEAD, origin/main, origin/master, main or master',
    )
  }

  private async upstreamOf(cwd: string): Promise<string | undefined> {
    const run = await this.git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    const name = run.stdout.trim()
    return run.ok && name.length > 0 ? name : undefined
  }

  private async resolves(cwd: string, ref: string): Promise<boolean> {
    const run = await this.git(cwd, ['rev-parse', '--verify', '--quiet', ref])
    return run.ok && run.stdout.trim().length > 0
  }

  private async count(cwd: string, range: string): Promise<number | null> {
    const run = await this.git(cwd, ['rev-list', '--count', range])
    const text = run.stdout.trim()
    if (!run.ok || !/^\d+$/.test(text)) return null
    return Number.parseInt(text, 10)
  }

  private async git(cwd: string, argv: readonly string[]) {
    await awaitWorkspace(this.args.gate)
    return await runGit({ processes: this.args.processes, cwd, argv })
  }
}

export const worktreesOf = (args: {
  calls: RemoteCalls
  gate?: WorkspaceGate | undefined
}): PodWorktrees =>
  new HostWorktrees({
    processes: new DaemonProcessPort({
      calls: args.calls,
      capabilities: () => args.calls.daemonCapabilities(),
    }),
    files: new DaemonFileSystemPort({ calls: args.calls }),
    ...(args.gate === undefined ? {} : { gate: args.gate }),
  })
