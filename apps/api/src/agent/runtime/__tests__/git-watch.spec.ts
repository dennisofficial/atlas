import { describe, expect, it } from 'bun:test'

import type { BranchSet } from '@dltech/atlas-protocol'
import { defineOp, type DaemonGroupFactory } from '@dltech/atlas-protocol/engine'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'
import { newKey, RemoteCalls, systemTimers, type DaemonConnector } from '@dltech/atlas-host'

import { watchWorkspaceRepos, type GitWatch } from '../git-watch'

const SANDBOX = 'git-watch-spec'
const SECRET = 'git-watch-secret'
const WORKTREE = '/w/.atlas/worktrees/b'
const OTHER_WORKTREE = '/w/.atlas/worktrees/c'

const emptySetFor = (repoPath: string): BranchSet => ({
  repoPath,
  head: null,
  branches: [],
  worktrees: [],
  remotes: [],
  checkouts: [],
})

const worktreeSetFor = (args: { repoPath: string; paths: readonly string[] }): BranchSet => ({
  ...emptySetFor(args.repoPath),
  worktrees: args.paths.map((path) => ({ path, branch: 'b', sha: 'abc1234', detached: false })),
})

const discoveringGitGroup = (): DaemonGroupFactory => () => ({
  name: 'git',
  ops: [
    defineOp({ op: 'git.watch', run: async ({ op }) => emptySetFor(op.repoPath) }),
    defineOp({ op: 'git.unwatch', run: async () => null }),
    defineOp({ op: 'git.read', run: async ({ op }) => emptySetFor(op.repoPath) }),
    defineOp({
      op: 'git.discover',
      run: async ({ ctx }) => {
        setTimeout(() => ctx.publish({ type: 'git.repo-found', repoPath: '/late' }), 10)
        return { repos: ['/cloned'] }
      },
    }),
  ],
})

const worktreeGitGroup =
  (state: { paths: readonly string[] }): DaemonGroupFactory =>
  () => ({
    name: 'git',
    ops: [
      defineOp({
        op: 'git.watch',
        run: async ({ op }) => worktreeSetFor({ repoPath: op.repoPath, paths: state.paths }),
      }),
      defineOp({ op: 'git.unwatch', run: async () => null }),
      defineOp({
        op: 'git.read',
        run: async ({ ctx, op }) => {
          const set = worktreeSetFor({ repoPath: op.repoPath, paths: state.paths })
          ctx.publish({ type: 'git.branches', set })
          return set
        },
      }),
      defineOp({ op: 'git.discover', run: async () => ({ repos: [] }) }),
    ],
  })

const connectedCalls = (args: {
  daemon: Awaited<ReturnType<typeof createInMemoryDaemon>>
  sessionId: string
}): RemoteCalls => {
  const calls = new RemoteCalls({
    sessionId: args.sessionId,
    token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
    connector: () =>
      Promise.resolve<DaemonConnector>((handlers) =>
        Promise.resolve(args.daemon.connectRaw(handlers)),
      ),
    timers: systemTimers,
    onFenced: () => {},
  })
  calls.open({ epoch: 1 })
  return calls
}

const publishBranches = async (args: { calls: RemoteCalls; repoPath: string }): Promise<void> => {
  const key = newKey()
  await args.calls.invoke({ key, op: { op: 'git.read', repoPath: args.repoPath } })
  await args.calls.ack({ key })
}

const untilCheckouts = async (args: {
  watch: GitWatch
  ready: (paths: readonly string[]) => boolean
}): Promise<readonly string[]> => {
  const deadline = Date.now() + 2_000
  for (;;) {
    const paths = await args.watch.watchedCheckouts()
    if (args.ready(paths)) return paths
    if (Date.now() > deadline) throw new Error(`the checkout set never caught up: ${paths.join()} `)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('watchWorkspaceRepos', () => {
  it('watches repos that resolve and acks every git.watch key', async () => {
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    const calls = new RemoteCalls({
      sessionId: 'session-git-watch',
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      connector: () =>
        Promise.resolve<DaemonConnector>((handlers) =>
          Promise.resolve(daemon.connectRaw(handlers)),
        ),
      timers: systemTimers,
      onFenced: () => {},
    })
    calls.open({ epoch: 1 })
    const acked: string[] = []
    const originalAck = calls.ack.bind(calls)
    calls.ack = async (args) => {
      acked.push(args.key)
      return originalAck(args)
    }
    const watchKeys: string[] = []
    const originalInvoke = calls.invoke.bind(calls)
    calls.invoke = async (args) => {
      if (args.op.op === 'git.watch') watchKeys.push(args.key)
      return originalInvoke(args)
    }

    const watch = watchWorkspaceRepos({
      calls,
      gate: Promise.resolve(),
      launchDirectory: '/w',
      additionalRepos: [{ repo: 'dennis/extra', branch: undefined }],
    })
    const repos = await watch.watchedRepos()
    expect(repos).toEqual(['/w', '/extra'])
    expect(watchKeys.length).toBe(2)
    for (const key of watchKeys) expect(acked).toContain(key)
    calls.close()
    await daemon.stop()
  })

  it('resolves empty when the gate rejects', async () => {
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    const calls = new RemoteCalls({
      sessionId: 'session-git-watch',
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      connector: () =>
        Promise.resolve<DaemonConnector>((handlers) =>
          Promise.resolve(daemon.connectRaw(handlers)),
        ),
      timers: systemTimers,
      onFenced: () => {},
    })
    calls.open({ epoch: 1 })
    const watch = watchWorkspaceRepos({
      calls,
      gate: Promise.reject(new Error('setup never landed')),
      launchDirectory: '/w',
      additionalRepos: [],
    })
    await expect(watch.watchedRepos()).resolves.toEqual([])
    calls.close()
    await daemon.stop()
  })

  it('adds discovered repos and reports each one through onRepo', async () => {
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
      groups: () => [discoveringGitGroup()],
    })
    const calls = connectedCalls({ daemon, sessionId: 'session-git-discover' })
    const watch = watchWorkspaceRepos({
      calls,
      gate: Promise.resolve(),
      launchDirectory: '/w',
      additionalRepos: [],
    })
    const found: string[] = []
    watch.onRepo((repoPath) => found.push(repoPath))
    await expect(watch.watchedRepos()).resolves.toEqual(['/w', '/cloned'])
    for (let index = 0; index < 100 && found.length < 3; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(found).toEqual(['/w', '/cloned', '/late'])
    await expect(watch.watchedRepos()).resolves.toEqual(['/w', '/cloned', '/late'])
    calls.close()
    await daemon.stop()
  })

  it('watches every worktree of a watched repo and reports it only through onCheckout', async () => {
    const state = { paths: [WORKTREE] as readonly string[] }
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
      groups: () => [worktreeGitGroup(state)],
    })
    const calls = connectedCalls({ daemon, sessionId: 'session-git-checkouts' })
    const watch = watchWorkspaceRepos({
      calls,
      gate: Promise.resolve(),
      launchDirectory: '/w',
      additionalRepos: [],
    })
    const checkouts: string[] = []
    const repos: string[] = []
    watch.onCheckout((checkoutPath) => checkouts.push(checkoutPath))
    watch.onRepo((repoPath) => repos.push(repoPath))

    await expect(watch.watchedCheckouts()).resolves.toEqual(['/w', WORKTREE])
    await expect(watch.watchedRepos()).resolves.toEqual(['/w'])
    expect(checkouts).toContain(WORKTREE)
    expect(repos).toEqual(['/w'])

    state.paths = [WORKTREE, OTHER_WORKTREE]
    await publishBranches({ calls, repoPath: '/w' })
    await expect(
      untilCheckouts({ watch, ready: (paths) => paths.includes(OTHER_WORKTREE) }),
    ).resolves.toEqual(['/w', WORKTREE, OTHER_WORKTREE])
    expect(checkouts).toContain(OTHER_WORKTREE)

    state.paths = [WORKTREE]
    await publishBranches({ calls, repoPath: '/w' })
    await expect(
      untilCheckouts({ watch, ready: (paths) => !paths.includes(OTHER_WORKTREE) }),
    ).resolves.toEqual(['/w', WORKTREE])
    calls.close()
    await daemon.stop()
  })
})
