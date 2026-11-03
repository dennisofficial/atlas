import { watch, type FSWatcher } from 'node:fs'
import { sep } from 'node:path'

import type { BranchSet } from '@dltech/atlas-protocol'
import { type DaemonGroupFactory, type GroupContext, defineOp } from '@dltech/atlas-protocol/engine'

import type { DaemonOpsDeps } from '../deps'
import {
  REF_FORMAT,
  branchSetsEqual,
  parseBranches,
  parseHead,
  parseWorktrees,
  watchPathOf,
} from './branch-set'
import { commonGitDirOf, runGit } from './git'

const DEBOUNCE_MS = 500

type WatchedRepo = {
  repoPath: string
  gitDir: string
  watchers: FSWatcher[]
  lastPublished: BranchSet
  timer: ReturnType<typeof setTimeout> | null
  refreshing: boolean
  pending: boolean
  stopped: boolean
}

const readBranchSet = async (args: {
  deps: DaemonOpsDeps
  repoPath: string
}): Promise<BranchSet> => {
  await commonGitDirOf({ deps: args.deps, repoPath: args.repoPath })
  const [refs, head, worktreeList] = await Promise.all([
    runGit({
      deps: args.deps,
      repoPath: args.repoPath,
      argv: ['for-each-ref', REF_FORMAT, 'refs/heads'],
    }),
    runGit({ deps: args.deps, repoPath: args.repoPath, argv: ['branch', '--show-current'] }),
    runGit({ deps: args.deps, repoPath: args.repoPath, argv: ['worktree', 'list', '--porcelain'] }),
  ])
  return {
    repoPath: args.repoPath,
    head: parseHead(head),
    branches: [...parseBranches(refs)],
    worktrees: [...parseWorktrees({ text: worktreeList, repoPath: args.repoPath })],
  }
}

const targetsOf = (gitDir: string): readonly string[] => [gitDir, `${gitDir}${sep}refs${sep}heads`]

export const gitGroup =
  (deps: DaemonOpsDeps): DaemonGroupFactory =>
  (ctx: GroupContext) => {
    const watched = new Map<string, WatchedRepo>()

    const publishChanged = (repo: WatchedRepo, set: BranchSet): void => {
      if (branchSetsEqual({ a: set, b: repo.lastPublished })) return
      repo.lastPublished = set
      ctx.publish({ type: 'git.branches', set })
    }

    const refresh = async (repo: WatchedRepo): Promise<void> => {
      if (repo.refreshing) {
        repo.pending = true
        return
      }
      repo.refreshing = true
      try {
        do {
          repo.pending = false
          const set = await readBranchSet({ deps, repoPath: repo.repoPath })
          if (!repo.stopped) publishChanged(repo, set)
        } while (repo.pending && !repo.stopped)
      } catch {
        repo.pending = false
      } finally {
        repo.refreshing = false
      }
    }

    const scheduleRefresh = (repo: WatchedRepo): void => {
      if (repo.timer !== null) clearTimeout(repo.timer)
      repo.timer = setTimeout(() => {
        repo.timer = null
        void refresh(repo)
      }, DEBOUNCE_MS)
    }

    const onFsEvent = (repo: WatchedRepo, filename: string): void => {
      if (repo.stopped) return
      if (watchPathOf({ gitDir: repo.gitDir, filename }) !== null) scheduleRefresh(repo)
    }

    const watchTarget = (repo: WatchedRepo, target: string): FSWatcher | null => {
      try {
        return watch(target, { recursive: true }, (_event, filename) => {
          const name =
            filename === null || filename === ''
              ? ''
              : target === repo.gitDir
                ? `${repo.gitDir}${sep}${filename}`
                : filename
          onFsEvent(repo, name)
        })
      } catch {
        return null
      }
    }

    const unwatchRepo = (repo: WatchedRepo): void => {
      repo.stopped = true
      if (repo.timer !== null) clearTimeout(repo.timer)
      repo.timer = null
      for (const watcher of repo.watchers) watcher.close()
      repo.watchers = []
    }

    const watchRepo = async (repoPath: string): Promise<BranchSet> => {
      const gitDir = await commonGitDirOf({ deps, repoPath })
      const existing = watched.get(repoPath)
      if (existing !== undefined) return existing.lastPublished
      const repo: WatchedRepo = {
        repoPath,
        gitDir,
        watchers: [],
        lastPublished: { repoPath, head: null, branches: [], worktrees: [] },
        timer: null,
        refreshing: false,
        pending: false,
        stopped: false,
      }
      const set = await readBranchSet({ deps, repoPath })
      repo.lastPublished = set
      for (const target of targetsOf(gitDir)) {
        const watcher = watchTarget(repo, target)
        if (watcher !== null) repo.watchers.push(watcher)
      }
      watched.set(repoPath, repo)
      return set
    }

    return {
      name: 'git',
      ops: [
        defineOp({
          op: 'git.watch',
          run: async ({ op }) => await watchRepo(op.repoPath),
        }),
        defineOp({
          op: 'git.unwatch',
          run: async ({ op }) => {
            const repo = watched.get(op.repoPath)
            if (repo !== undefined) {
              unwatchRepo(repo)
              watched.delete(op.repoPath)
            }
            return null
          },
        }),
        defineOp({
          op: 'git.read',
          run: async ({ op }) => await readBranchSet({ deps, repoPath: op.repoPath }),
        }),
      ],
      onConnect: () => {
        for (const repo of watched.values()) {
          ctx.publish({ type: 'git.branches', set: repo.lastPublished })
        }
      },
      stop: async () => {
        for (const repo of watched.values()) unwatchRepo(repo)
        watched.clear()
      },
    }
  }
