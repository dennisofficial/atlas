import { describe, expect, it } from 'bun:test'

import type { BranchSet } from '@dltech/atlas-protocol'
import { defineOp, type DaemonGroupFactory } from '@dltech/atlas-protocol/engine'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'
import { RemoteCalls, systemTimers, type DaemonConnector } from '@dltech/atlas-host'

import { watchWorkspaceRepos } from '../git-watch'

const SANDBOX = 'git-watch-spec'
const SECRET = 'git-watch-secret'

const emptySetFor = (repoPath: string): BranchSet => ({
  repoPath,
  head: null,
  branches: [],
  worktrees: [],
  remotes: [],
  checkouts: [],
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
})
