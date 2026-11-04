import { describe, expect, it } from 'bun:test'

import { chainEvents, toRunId, toThreadId, type BranchesObserved } from '@dltech/atlas-core'
import { defineOp, type DaemonGroupFactory } from '@dltech/atlas-protocol/engine'
import type { BranchSet } from '@dltech/atlas-protocol'
import {
  createInMemoryDaemon,
  inMemoryDaemonToken,
  type InMemoryDaemonSocket,
} from '@dltech/atlas-protocol/testing'

import { RemoteCalls } from '../../calls/remote-calls'
import type { DaemonConnector } from '../../calls/socket'
import { BranchObserver, type BranchRecorder } from '../branch-observer'
import { FakeClock, SANDBOX, SECRET } from './rig-fakes'

const threadId = toThreadId('thread-branches')

const SET: BranchSet = {
  repoPath: '/w',
  head: 'aaa111',
  branches: [{ name: 'main', sha: 'aaa111' }],
  worktrees: [{ path: '/w', branch: 'main', sha: 'aaa111', detached: false }],
}

const CHANGED: BranchSet = {
  ...SET,
  branches: [...SET.branches, { name: 'feat-x', sha: 'bbb222' }],
}

const publishingGitGroup = (): DaemonGroupFactory => {
  return () => ({
    name: 'git',
    ops: [
      defineOp({
        op: 'git.watch',
        run: async ({ op, ctx: callCtx }) => {
          callCtx.publish({ type: 'git.branches', set: { ...SET, repoPath: op.repoPath } })
          return { ...SET, repoPath: op.repoPath }
        },
      }),
      defineOp({
        op: 'git.unwatch',
        run: async () => null,
      }),
      defineOp({
        op: 'git.read',
        run: async ({ op }) => ({ ...CHANGED, repoPath: op.repoPath }),
      }),
    ],
  })
}

const makeDaemon = () =>
  createInMemoryDaemon({
    version: 'test',
    sandboxName: SANDBOX,
    secret: SECRET,
    groups: () => [publishingGitGroup()],
  })

const connect = (daemon: Awaited<ReturnType<typeof makeDaemon>>): RemoteCalls => {
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

const fakeRecord = (): BranchRecorder & { appended: BranchesObserved[] } => {
  const appended: BranchesObserved[] = []
  return {
    appended,
    append: async ({ body }) => {
      appended.push(body)
    },
    events: () =>
      chainEvents({
        threadId,
        runId: toRunId('run-1'),
        epoch: 1,
        at: '2026-11-04T00:00:00.000Z',
        bodies: appended,
      }),
  }
}

describe('RemoteCalls.onEvent', () => {
  it('delivers daemon event frames to subscribers', async () => {
    const daemon = await makeDaemon()
    const calls = connect(daemon)
    const seen: string[] = []
    const received = new Promise<void>((resolve) => {
      calls.onEvent((frame) => {
        if (frame.event.type !== 'git.branches') return
        seen.push(frame.event.set.repoPath)
        resolve()
      })
    })
    await calls.ready()
    const result = await calls.invoke({ key: 'k1', op: { op: 'git.watch', repoPath: '/w' } })
    expect(result.status).toBe('ok')
    await received
    expect(seen).toEqual(['/w'])
    calls.close()
    await daemon.stop()
  })
})

describe('BranchObserver', () => {
  it('records a branches-observed from a pushed git.branches event', async () => {
    const daemon = await makeDaemon()
    const calls = connect(daemon)
    const record = fakeRecord()
    const observer = new BranchObserver({
      record,
      remoteCalls: calls,
      threadId,
      repos: async () => [],
      runId: () => toRunId('run-1'),
    })
    observer.start()
    await calls.ready()
    await calls.invoke({ key: 'k1', op: { op: 'git.watch', repoPath: '/w' } })
    await observer.refresh()
    expect(record.appended).toHaveLength(1)
    expect(record.appended[0]?.repo).toBe('/w')
    calls.close()
    await daemon.stop()
  })

  it('refresh reads each repo and records only changes', async () => {
    const daemon = await makeDaemon()
    const calls = connect(daemon)
    const record = fakeRecord()
    const observer = new BranchObserver({
      record,
      remoteCalls: calls,
      threadId,
      repos: async () => ['/w'],
      runId: () => toRunId('run-1'),
    })
    await calls.ready()
    await observer.refresh()
    await observer.refresh()
    expect(record.appended).toHaveLength(1)
    expect(record.appended[0]?.branches.map((branch) => branch.name)).toEqual(['main', 'feat-x'])
    calls.close()
    await daemon.stop()
  })

  it('ignores a failing git.read', async () => {
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    const calls = connect(daemon)
    const record = fakeRecord()
    const observer = new BranchObserver({
      record,
      remoteCalls: calls,
      threadId,
      repos: async () => ['/missing'],
      runId: () => toRunId('run-1'),
    })
    await calls.ready()
    await observer.refresh()
    expect(record.appended).toHaveLength(0)
    calls.close()
    await daemon.stop()
  })
})
