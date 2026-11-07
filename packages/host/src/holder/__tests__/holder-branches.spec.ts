import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId, type BranchesObserved } from '@dltech/atlas-core'
import { defineOp, type DaemonGroupFactory } from '@dltech/atlas-protocol/engine'
import { ECallStatus, type BranchSet } from '@dltech/atlas-protocol'
import {
  createInMemoryDaemon,
  inMemoryDaemonToken,
  type InMemoryDaemonSocket,
} from '@dltech/atlas-protocol/testing'

import { RemoteCalls } from '../../calls/remote-calls'
import type { DaemonConnector, DaemonLinkHandlers } from '../../calls/socket'
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

const publishingGitGroup = (reads: { count: number }): DaemonGroupFactory => {
  return () => ({
    name: 'git',
    ops: [
      defineOp({
        op: 'git.watch',
        run: async ({ op, ctx: callCtx }) => {
          callCtx.publish({
            type: 'git.branches',
            set: { ...SET, repoPath: op.repoPath },
          })
          return { ...SET, repoPath: op.repoPath }
        },
      }),
      defineOp({
        op: 'git.unwatch',
        run: async () => null,
      }),
      defineOp({
        op: 'git.read',
        run: async ({ op }) => {
          reads.count += 1
          return { ...CHANGED, repoPath: op.repoPath }
        },
      }),
    ],
  })
}

const makeDaemon = (reads: { count: number } = { count: 0 }) =>
  createInMemoryDaemon({
    version: 'test',
    sandboxName: SANDBOX,
    secret: SECRET,
    groups: () => [publishingGitGroup(reads)],
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

const fakeRecord = (): BranchRecorder & {
  appended: BranchesObserved[]
  facts: Map<string, string>
} => {
  const appended: BranchesObserved[] = []
  const facts = new Map<string, string>()
  return {
    appended,
    facts,
    recordedBase: (repo) => facts.get(repo),
    rememberBase: async ({ repo, base }) => {
      facts.set(repo, base)
    },
    append: async ({ body }) => {
      appended.push(body)
    },
    lastObservation: (repo) => appended.findLast((body) => body.repo === repo),
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
    const result = await calls.invoke({
      key: 'k1',
      op: { op: 'git.watch', repoPath: '/w' },
    })
    expect(result.status).toBe(ECallStatus.Ok)
    await received
    expect(seen).toEqual(['/w'])
    calls.close()
    await daemon.stop()
  })

  it('keeps delivering to other listeners when one throws', async () => {
    const daemon = await makeDaemon()
    const calls = connect(daemon)
    const seen: string[] = []
    const received = new Promise<void>((resolve) => {
      calls.onEvent(() => {
        throw new Error('boom')
      })
      calls.onEvent((frame) => {
        if (frame.event.type !== 'git.branches') return
        seen.push(frame.event.set.repoPath)
        resolve()
      })
    })
    await calls.ready()
    await calls.invoke({ key: 'k1', op: { op: 'git.watch', repoPath: '/w' } })
    await received
    expect(seen).toEqual(['/w'])
    calls.close()
    await daemon.stop()
  })

  it('stops delivering after unsubscribe', async () => {
    const daemon = await makeDaemon()
    const calls = connect(daemon)
    const seen: string[] = []
    const off = calls.onEvent((frame) => {
      if (frame.event.type === 'git.branches') seen.push(frame.event.set.repoPath)
    })
    await calls.ready()
    await calls.invoke({ key: 'k1', op: { op: 'git.watch', repoPath: '/w' } })
    for (let index = 0; index < 50 && seen.length === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(seen).toEqual(['/w'])
    off()
    await calls.invoke({ key: 'k2', op: { op: 'git.watch', repoPath: '/w' } })
    for (let index = 0; index < 10; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(seen).toEqual(['/w'])
    calls.close()
    await daemon.stop()
  })

  it('clears listeners on close', async () => {
    let handlers: DaemonLinkHandlers | undefined
    const calls = new RemoteCalls({
      sessionId: 'session-branches',
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      connector: () =>
        Promise.resolve<DaemonConnector>((link) => {
          handlers = link
          return Promise.resolve({ send: () => {}, close: () => {} })
        }),
      timers: new FakeClock(),
      onFenced: () => {},
    })
    calls.open({ epoch: 1 })
    for (let index = 0; index < 100 && handlers === undefined; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    handlers?.onText(JSON.stringify({ kind: 'hello-reply', bootId: 'b1', version: 'test' }))
    await calls.ready()
    const seen: string[] = []
    calls.onEvent(() => {
      seen.push('x')
    })
    const eventText = JSON.stringify({
      kind: 'event',
      event: { type: 'git.branches', set: SET },
    })
    handlers?.onText(eventText)
    expect(seen).toEqual(['x'])
    calls.close()
    handlers?.onText(eventText)
    expect(seen).toEqual(['x'])
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
      signal: new AbortController().signal,
      repos: async () => [],
      baseOf: () => null,
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
      signal: new AbortController().signal,
      repos: async () => ['/w'],
      baseOf: () => null,
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
      signal: new AbortController().signal,
      repos: async () => ['/missing'],
      baseOf: () => null,
      runId: () => toRunId('run-1'),
    })
    await calls.ready()
    await observer.refresh()
    expect(record.appended).toHaveLength(0)
    calls.close()
    await daemon.stop()
  })

  it('acks every git.read key so the daemon retains nothing', async () => {
    const reads = { count: 0 }
    const daemon = await makeDaemon(reads)
    const calls = connect(daemon)
    const acked: string[] = []
    const originalAck = calls.ack.bind(calls)
    calls.ack = async (args) => {
      acked.push(args.key)
      return originalAck(args)
    }
    const readKeys: string[] = []
    const originalInvoke = calls.invoke.bind(calls)
    calls.invoke = async (args) => {
      if (args.op.op === 'git.read') readKeys.push(args.key)
      return originalInvoke(args)
    }
    const record = fakeRecord()
    const observer = new BranchObserver({
      record,
      remoteCalls: calls,
      threadId,
      signal: new AbortController().signal,
      repos: async () => ['/w'],
      baseOf: () => null,
      runId: () => toRunId('run-1'),
    })
    await calls.ready()
    await observer.refresh()
    const [key] = readKeys
    expect(key).toBeDefined()
    if (key === undefined) return
    expect(acked).toContain(key)
    const before = reads.count
    const replay = await originalInvoke({
      key,
      op: { op: 'git.read', repoPath: '/w' },
    })
    expect(replay.status).toBe(ECallStatus.Ok)
    expect(reads.count).toBe(before + 1)
    calls.close()
    await daemon.stop()
  })

  const observerOver = (args: {
    record: ReturnType<typeof fakeRecord>
    calls: RemoteCalls
    baseOf: (repo: string) => string | null
  }) =>
    new BranchObserver({
      record: args.record,
      remoteCalls: args.calls,
      threadId,
      signal: new AbortController().signal,
      repos: async () => ['/w'],
      baseOf: args.baseOf,
      runId: () => toRunId('run-1'),
    })

  it('stamps the configured base on the observation', async () => {
    const daemon = await makeDaemon()
    const calls = connect(daemon)
    const record = fakeRecord()
    await calls.ready()
    await observerOver({ record, calls, baseOf: () => 'develop' }).refresh()
    expect(record.appended[0]?.base).toBe('develop')
    expect(record.facts.size).toBe(0)
    calls.close()
    await daemon.stop()
  })

  it('falls back to the checked-out head on the first observation and remembers it', async () => {
    const daemon = await makeDaemon()
    const calls = connect(daemon)
    const record = fakeRecord()
    await calls.ready()
    await observerOver({ record, calls, baseOf: () => null }).refresh()
    expect(record.appended[0]?.base).toBe('aaa111')
    expect(record.facts.get('/w')).toBe('aaa111')
    calls.close()
    await daemon.stop()
  })

  it('a new holder reads the remembered base instead of the current head', async () => {
    const daemon = await makeDaemon()
    const calls = connect(daemon)
    const record = fakeRecord()
    record.facts.set('/w', 'main')
    record.appended.push({
      type: 'branches-observed',
      repo: '/w',
      head: 'feat-x',
      base: 'main',
      branches: [],
      worktrees: [],
    })
    await calls.ready()
    await observerOver({ record, calls, baseOf: () => null }).refresh()
    expect(record.appended.at(-1)?.base).toBe('main')
    calls.close()
    await daemon.stop()
  })

  it('leaves base off when none is known and the record already has observations', async () => {
    const daemon = await makeDaemon()
    const calls = connect(daemon)
    const record = fakeRecord()
    record.appended.push({
      type: 'branches-observed',
      repo: '/w',
      head: 'old',
      branches: [],
      worktrees: [],
    })
    await calls.ready()
    await observerOver({ record, calls, baseOf: () => null }).refresh()
    expect(record.appended.at(-1)).not.toHaveProperty('base')
    calls.close()
    await daemon.stop()
  })
})
