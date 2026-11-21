import { toThreadId, type BranchesObserved } from '@dltech/atlas-core'
import { defineOp, type DaemonGroupFactory } from '@dltech/atlas-protocol/engine'
import type { BranchSet } from '@dltech/atlas-protocol'
import {
  createInMemoryDaemon,
  inMemoryDaemonToken,
  type InMemoryDaemonSocket,
} from '@dltech/atlas-protocol/testing'

import { RemoteCalls } from '../../calls/remote-calls'
import type { DaemonConnector } from '../../calls/socket'
import type { BranchRecorder } from '../branch-observer'
import { FakeClock, SANDBOX, SECRET } from './rig-fakes'

export const threadId = toThreadId('thread-branches')

export const SET: BranchSet = {
  repoPath: '/w',
  head: 'aaa111',
  branches: [{ name: 'main', sha: 'aaa111', pushRemote: null }],
  worktrees: [{ path: '/w', branch: 'main', sha: 'aaa111', detached: false }],
  remotes: [{ name: 'origin', url: 'git@github.com:acme/app.git' }],
  checkouts: ['main'],
}

export const CHANGED: BranchSet = {
  ...SET,
  branches: [...SET.branches, { name: 'feat-x', sha: 'bbb222', pushRemote: null }],
}

const withDefaultBranch = (args: { set: BranchSet; defaultBranch: string | null }): BranchSet =>
  args.defaultBranch === null ? args.set : { ...args.set, defaultBranch: args.defaultBranch }

const readSet = (args: { set: BranchSet; defaultBranch: string | null }): BranchSet =>
  withDefaultBranch(args)

export const publishingGitGroup = (args: {
  reads: { count: number }
  defaultBranch: string | null
}): DaemonGroupFactory => {
  return () => ({
    name: 'git',
    ops: [
      defineOp({
        op: 'git.watch',
        run: async ({ op, ctx: callCtx }) => {
          callCtx.publish({
            type: 'git.branches',
            set: readSet({
              set: { ...SET, repoPath: op.repoPath },
              defaultBranch: args.defaultBranch,
            }),
          })
          return readSet({
            set: { ...SET, repoPath: op.repoPath },
            defaultBranch: args.defaultBranch,
          })
        },
      }),
      defineOp({
        op: 'git.unwatch',
        run: async () => null,
      }),
      defineOp({
        op: 'git.read',
        run: async ({ op }) => {
          args.reads.count += 1
          return readSet({
            set: { ...CHANGED, repoPath: op.repoPath },
            defaultBranch: args.defaultBranch,
          })
        },
      }),
    ],
  })
}

export const makeDaemon = (
  reads: { count: number } = { count: 0 },
  defaultBranch: string | null = null,
) =>
  createInMemoryDaemon({
    version: 'test',
    sandboxName: SANDBOX,
    secret: SECRET,
    groups: () => [publishingGitGroup({ reads, defaultBranch })],
  })

export const connect = (daemon: Awaited<ReturnType<typeof makeDaemon>>): RemoteCalls => {
  const calls = new RemoteCalls({
    sessionId: 'session-branches',
    token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
    connector: () =>
      Promise.resolve<DaemonConnector>((handlers) =>
        Promise.resolve<InMemoryDaemonSocket>(daemon.connectRaw(handlers)),
      ),
    timers: new FakeClock(),
    onFenced: () => {},
  })
  calls.open({ epoch: 1 })
  return calls
}

export const fakeRecord = (): BranchRecorder & {
  appended: BranchesObserved[]
  facts: Map<string, string>
} => {
  const appended: BranchesObserved[] = []
  const facts = new Map<string, string>()
  return {
    appended,
    facts,
    recordedBase: (repo) => facts.get(repo),
    append: async ({ body }) => {
      appended.push(body)
    },
    lastObservation: (repo) => appended.findLast((body) => body.repo === repo),
    hasObservation: () => appended.length > 0,
  }
}
