import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $ } from 'bun'
import { afterAll, describe, expect, it } from 'bun:test'

import { ECallFailure, type BranchSet, type CallOp } from '../../ops'
import type { DaemonSession } from '../client'
import {
  connectAt,
  failureOf,
  okValue,
  runToEnd,
  sleep,
  withDaemon,
  type DaemonConformanceTarget,
} from './support'

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Atlas Test',
  GIT_AUTHOR_EMAIL: 'atlas@test.invalid',
  GIT_COMMITTER_NAME: 'Atlas Test',
  GIT_COMMITTER_EMAIL: 'atlas@test.invalid',
}

const tempDirs: string[] = []

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs.length = 0
})

const makeRepo = async (): Promise<string> => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-git-conformance-'))
  tempDirs.push(dir)
  const sh = $.env(gitEnv)
  await sh`git init -b main ${dir}`.quiet()
  writeFileSync(join(dir, 'seed.txt'), 'seed\n')
  await sh`git -C ${dir} add seed.txt`.quiet()
  await sh`git -C ${dir} commit -m seed`.quiet()
  return dir
}

const createBranches = async (args: {
  repoPath: string
  names: readonly string[]
}): Promise<void> => {
  const sh = $.env(gitEnv)
  for (const name of args.names) await sh`git -C ${args.repoPath} branch ${name}`.quiet()
}

const gitOp = (op: 'git.watch' | 'git.unwatch' | 'git.read', repoPath: string): CallOp => ({
  op,
  repoPath,
})

const runGitOp = async (args: {
  session: DaemonSession
  key: string
  op: 'git.watch' | 'git.unwatch' | 'git.read'
  repoPath: string
}) =>
  await runToEnd({
    session: args.session,
    key: args.key,
    op: gitOp(args.op, args.repoPath),
    timeoutMs: 15000,
  })

const waitForBranchSet = async (args: {
  session: DaemonSession
  contains: string
  timeoutMs?: number
}): Promise<BranchSet> => {
  const deadline = Date.now() + (args.timeoutMs ?? 8000)
  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw new Error(
        `no git.branches event containing ${args.contains}; saw ${JSON.stringify(args.session.frames().filter((f) => f.kind === 'event'))}`,
      )
    }
    const frame = await args.session.until(
      (candidate) =>
        candidate.kind === 'event' &&
        candidate.event.type === 'git.branches' &&
        candidate.event.set.branches.some((branch) => branch.name === args.contains),
      { label: `git.branches containing ${args.contains}`, timeoutMs: remaining },
    )
    if (frame.kind !== 'event' || frame.event.type !== 'git.branches')
      throw new Error('unreachable')
    return frame.event.set
  }
}

const collectEvents = (args: {
  session: DaemonSession
  ms: number
}): Promise<readonly BranchSet[]> =>
  new Promise((resolve) => {
    const sets: BranchSet[] = []
    const timer = setTimeout(() => {
      args.session.close()
      resolve(sets)
    }, args.ms)
    void (async () => {
      for (;;) {
        try {
          const frame = await args.session.until(
            (candidate) => candidate.kind === 'event' && candidate.event.type === 'git.branches',
            { label: 'git.branches', timeoutMs: args.ms },
          )
          if (frame.kind !== 'event' || frame.event.type !== 'git.branches') continue
          sets.push(frame.event.set)
        } catch {
          clearTimeout(timer)
          resolve(sets)
          return
        }
      }
    })()
  })

export const describeGitConformance = (target: DaemonConformanceTarget): void => {
  describe(`git conformance (${target.name})`, () => {
    it('fails git.read on a non-repository', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const missing = join(tmpdir(), `atlas-git-missing-${Date.now()}`)
          mkdirSync(missing, { recursive: true })
          tempDirs.push(missing)
          const result = await runGitOp({
            session,
            key: 'g-nonrepo',
            op: 'git.read',
            repoPath: missing,
          })
          expect(failureOf(result)).toBe(ECallFailure.NotFound)
        },
      }))

    it('returns null for git.unwatch on an unwatched repo, twice', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const first = await runGitOp({
            session,
            key: 'g-unwatch-1',
            op: 'git.unwatch',
            repoPath: '/nowhere',
          })
          expect(okValue({ result: first, op: 'git.unwatch' })).toBeNull()
          const second = await runGitOp({
            session,
            key: 'g-unwatch-2',
            op: 'git.unwatch',
            repoPath: '/nowhere',
          })
          expect(okValue({ result: second, op: 'git.unwatch' })).toBeNull()
        },
      }))

    it('returns the seeded empty set for git.watch (fake only: the fake keeps an in-memory repo map)', () =>
      withDaemon({
        target,
        body: async (handle) => {
          if (handle.realProcesses) return
          const session = await connectAt({ handle })
          const result = await runGitOp({
            session,
            key: 'g-shape',
            op: 'git.watch',
            repoPath: '/fake/repo',
          })
          const set = okValue({ result, op: 'git.watch' })
          expect(set).toEqual({ repoPath: '/fake/repo', head: null, branches: [], worktrees: [] })
        },
      }))

    it('emits the initial set on git.watch (real only)', async () => {
      const handle = await target.start()
      try {
        if (!handle.realProcesses) return
        const repoPath = await makeRepo()
        const session = await connectAt({ handle })
        const result = await runGitOp({ session, key: 'g-initial', op: 'git.watch', repoPath })
        const set = okValue({ result, op: 'git.watch' })
        expect(set.repoPath).toBe(repoPath)
        expect(set.head).toBe('main')
        expect(set.branches.map((branch) => branch.name)).toEqual(['main'])
        expect(set.worktrees).toEqual([])
      } finally {
        await handle.stop()
      }
    })

    it('publishes one git.branches event after a new branch (real only)', async () => {
      const handle = await target.start()
      try {
        if (!handle.realProcesses) return
        const repoPath = await makeRepo()
        const session = await connectAt({ handle })
        await runGitOp({ session, key: 'g-watch-1', op: 'git.watch', repoPath })
        await createBranches({ repoPath, names: ['feat'] })
        const set = await waitForBranchSet({ session, contains: 'feat', timeoutMs: 8000 })
        expect(set.branches.map((branch) => branch.name).sort()).toEqual(['feat', 'main'])
      } finally {
        await handle.stop()
      }
    })

    it('debounces a burst of 20 branch creations to at most 3 events (real only)', async () => {
      const handle = await target.start()
      try {
        if (!handle.realProcesses) return
        const repoPath = await makeRepo()
        const session = await connectAt({ handle })
        await runGitOp({ session, key: 'g-watch-burst', op: 'git.watch', repoPath })
        const names = Array.from({ length: 20 }, (_, index) => `burst-${index}`)
        const collecting = collectEvents({ session, ms: 10000 })
        await createBranches({ repoPath, names })
        const sets = await collecting
        expect(sets.length).toBeGreaterThanOrEqual(1)
        expect(sets.length).toBeLessThanOrEqual(3)
        const last = sets[sets.length - 1]
        if (last === undefined) throw new Error('no git.branches events collected')
        for (const name of names) {
          expect(last.branches.some((branch) => branch.name === name)).toBe(true)
        }
      } finally {
        await handle.stop()
      }
    }, 20000)

    it('lists a linked worktree after git worktree add (real only)', async () => {
      const handle = await target.start()
      try {
        if (!handle.realProcesses) return
        const repoPath = await makeRepo()
        const session = await connectAt({ handle })
        await runGitOp({ session, key: 'g-watch-wt', op: 'git.watch', repoPath })
        const linked = join(repoPath, '..', `${repoPath.split('/').pop() ?? 'repo'}-wt`)
        const sh = $.env(gitEnv)
        await sh`git -C ${repoPath} worktree add ${linked} -b wt-branch`.quiet()
        const deadline = Date.now() + 8000
        let set: BranchSet | null = null
        for (;;) {
          const remaining = deadline - Date.now()
          if (remaining <= 0) break
          try {
            const frame = await session.until(
              (candidate) =>
                candidate.kind === 'event' &&
                candidate.event.type === 'git.branches' &&
                candidate.event.set.worktrees.length > 0,
              { label: 'git.branches with a worktree', timeoutMs: remaining },
            )
            if (frame.kind === 'event' && frame.event.type === 'git.branches') {
              set = frame.event.set
              break
            }
          } catch {
            break
          }
        }
        const read = await runGitOp({ session, key: 'g-read-wt', op: 'git.read', repoPath })
        const readSet = okValue({ result: read, op: 'git.read' })
        const worktrees = set === null ? readSet.worktrees : set.worktrees
        expect(worktrees.length).toBe(1)
        expect(worktrees[0]?.path).toBe(linked)
        expect(worktrees[0]?.branch).toBe('wt-branch')
        expect(worktrees[0]?.detached).toBe(false)
      } finally {
        await handle.stop()
      }
    })

    it('publishes nothing when a change does not alter the set (real only)', async () => {
      const handle = await target.start()
      try {
        if (!handle.realProcesses) return
        const repoPath = await makeRepo()
        const session = await connectAt({ handle })
        await runGitOp({ session, key: 'g-watch-noop', op: 'git.watch', repoPath })
        const sh = $.env(gitEnv)
        await sh`git -C ${repoPath} branch noop`.quiet()
        const first = await waitForBranchSet({ session, contains: 'noop', timeoutMs: 8000 })
        expect(first.branches.some((branch) => branch.name === 'noop')).toBe(true)
        const collecting = collectEvents({ session, ms: 2500 })
        await sh`git -C ${repoPath} update-ref refs/heads/noop refs/heads/noop`.quiet()
        writeFileSync(join(repoPath, 'seed.txt'), 'seed again\n')
        const sets = await collecting
        expect(sets.length).toBe(0)
      } finally {
        await handle.stop()
      }
    })

    it('republishes one event per watched repo on reconnect (real only)', async () => {
      const handle = await target.start()
      try {
        if (!handle.realProcesses) return
        const repoPath = await makeRepo()
        const first = await connectAt({ handle })
        await runGitOp({ session: first, key: 'g-watch-rc', op: 'git.watch', repoPath })
        first.close()
        await sleep(200)
        const second = await connectAt({ handle })
        const frame = await second.until(
          (candidate) => candidate.kind === 'event' && candidate.event.type === 'git.branches',
          { label: 'git.branches on reconnect', timeoutMs: 8000 },
        )
        if (frame.kind !== 'event' || frame.event.type !== 'git.branches')
          throw new Error('unreachable')
        expect(frame.event.set.repoPath).toBe(repoPath)
        expect(frame.event.set.branches.map((branch) => branch.name)).toEqual(['main'])
      } finally {
        await handle.stop()
      }
    })
  })
}
