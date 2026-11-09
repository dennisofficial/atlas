import { join } from 'node:path'

import type { FileSystemPort, ProcessPort } from '@dltech/atlas-core'
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
import { complaintOf, runGit } from './git'
import { parseStatus, parseWorktrees } from './parse'

const WORKTREE_HOME = '.atlas/worktrees'
const ORIGIN = 'origin'
const ORIGIN_PREFIX = `${ORIGIN}/`
const CANDIDATE_BRANCHES = ['main', 'master'] as const
const CHANGED_PATH_SAMPLE = 5

type Base = { ref: string; fromOrigin: boolean }

export class HostWorktrees implements PodWorktrees {
  constructor(private readonly args: { processes: ProcessPort; files: FileSystemPort }) {}

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
    const { repository } = await this.list({ cwd: args.cwd })
    const home = join(repository, WORKTREE_HOME)
    await this.args.files.mkdir({ path: home })
    await this.args.files.writeFile({ path: join(home, '.gitignore'), content: '*\n' })
    const fetched = await this.git(repository, ['fetch', ORIGIN])
    const base = await this.baseOf(repository)
    const path = join(home, args.name)
    const added = await this.git(repository, ['worktree', 'add', path, '-b', args.name, base.ref])
    if (!added.ok) throw new Error(complaintOf(added))
    return { path, branch: args.name, base: base.ref, staleBase: base.fromOrigin && !fetched.ok }
  }

  async inspect(args: { cwd: string; base?: string | undefined }): Promise<WorktreeState> {
    const status = await this.git(args.cwd, ['status', '--porcelain'])
    const changed = status.ok ? parseStatus({ output: status.stdout }) : []
    const upstream = await this.upstreamOf(args.cwd)
    const unpushed = await this.unpushedOf({ cwd: args.cwd, upstream, base: args.base })
    const behind =
      upstream === undefined ? undefined : await this.count(args.cwd, `HEAD..${upstream}`)
    return {
      isClean: changed.length === 0 && unpushed === 0,
      changedPaths: changed.slice(0, CHANGED_PATH_SAMPLE),
      changedCount: changed.length,
      unpushedCommits: unpushed,
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
    const argv = args.force
      ? ['worktree', 'remove', '--force', args.path]
      : ['worktree', 'remove', args.path]
    const removed = await this.git(args.cwd, argv)
    if (!removed.ok) throw new Error(complaintOf(removed))
    if (args.branch === undefined) return { branch: undefined, branchDeleted: undefined }
    const deleted = await this.git(args.cwd, ['branch', '-D', args.branch])
    return { branch: args.branch, branchDeleted: deleted.ok }
  }

  private async unpushedOf(args: {
    cwd: string
    upstream: string | undefined
    base: string | undefined
  }): Promise<number> {
    if (args.upstream !== undefined) return await this.count(args.cwd, `${args.upstream}..HEAD`)
    if (args.base === undefined) return 0
    return await this.count(args.cwd, `${args.base}..HEAD`)
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

  private async count(cwd: string, range: string): Promise<number> {
    const run = await this.git(cwd, ['rev-list', '--count', range])
    const parsed = Number.parseInt(run.stdout.trim(), 10)
    return run.ok && !Number.isNaN(parsed) ? parsed : 0
  }

  private git(cwd: string, argv: readonly string[]) {
    return runGit({ processes: this.args.processes, cwd, argv })
  }
}

export const worktreesOf = (args: { calls: RemoteCalls }): PodWorktrees =>
  new HostWorktrees({
    processes: new DaemonProcessPort({ calls: args.calls }),
    files: new DaemonFileSystemPort({ calls: args.calls }),
  })
