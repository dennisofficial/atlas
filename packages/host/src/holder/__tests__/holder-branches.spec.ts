import { describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'
import { ECallStatus } from '@dltech/atlas-protocol'
import { createInMemoryDaemon } from '@dltech/atlas-protocol/testing'

import type { RemoteCalls } from '../../calls/remote-calls'
import { BranchObserver } from '../branch-observer'
import { connect, fakeRecord, makeDaemon, threadId } from './branches-fixtures'
import { SANDBOX, SECRET } from './rig-fakes'

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

  it('does not append the same observation twice when the record misses the last one', async () => {
    const daemon = await makeDaemon()
    const calls = connect(daemon)
    const base = fakeRecord()
    const record = { ...base, lastObservation: (): undefined => undefined }
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

  it('leaves base off rather than adopting the checked-out head as the base', async () => {
    const daemon = await makeDaemon()
    const calls = connect(daemon)
    const record = fakeRecord()
    await calls.ready()
    await observerOver({ record, calls, baseOf: () => null }).refresh()
    expect(record.appended[0]).not.toHaveProperty('base')
    expect(record.facts.size).toBe(0)
    calls.close()
    await daemon.stop()
  })

  it('falls back to the remote default branch when no base is configured', async () => {
    const daemon = await makeDaemon({ count: 0 }, 'main')
    const calls = connect(daemon)
    const record = fakeRecord()
    await calls.ready()
    await observerOver({ record, calls, baseOf: () => null }).refresh()
    expect(record.appended[0]?.base).toBe('main')
    calls.close()
    await daemon.stop()
  })

  it('prefers a configured base over the remote default branch', async () => {
    const daemon = await makeDaemon({ count: 0 }, 'main')
    const calls = connect(daemon)
    const record = fakeRecord()
    await calls.ready()
    await observerOver({ record, calls, baseOf: () => 'develop' }).refresh()
    expect(record.appended[0]?.base).toBe('develop')
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

describe('BranchObserver start', () => {
  const waitFor = async (ready: () => boolean, ms = 2_000): Promise<void> => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (ready()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('the observer never read the repo')
  }

  it('reads every watched repo at start, before any turn ends', async () => {
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
    observer.start()
    await waitFor(() => record.appended.length === 1)
    expect(record.appended[0]?.repo).toBe('/w')
    calls.close()
    await daemon.stop()
  })

  it('reads a repo the watch reports after start', async () => {
    const daemon = await makeDaemon()
    const calls = connect(daemon)
    const record = fakeRecord()
    let report: ((repoPath: string) => void) | undefined
    const observer = new BranchObserver({
      record,
      remoteCalls: calls,
      threadId,
      signal: new AbortController().signal,
      repos: async () => [],
      onRepo: (listener) => {
        report = listener
        return () => {
          report = undefined
        }
      },
      baseOf: () => null,
      runId: () => toRunId('run-1'),
    })
    observer.start()
    await calls.ready()
    report?.('/cloned')
    await waitFor(() => record.appended.some((body) => body.repo === '/cloned'))
    calls.close()
    await daemon.stop()
  })
})
