import { describe, expect, it } from 'bun:test'
import { LogPort, type LogEntry } from '@dltech/atlas-observability'
import type { BranchSet } from '@dltech/atlas-protocol'
import { defineOp, type DaemonGroupFactory } from '@dltech/atlas-protocol/engine'
import { createInMemoryDaemon, type InMemoryDaemon } from '@dltech/atlas-protocol/testing'

import {
  FakeClock,
  flushUntil,
  makeRig,
  SANDBOX,
  SECRET,
  seedSession,
  SESSION,
  THREAD_ID,
  type HolderRig,
} from './holder-rig'

class CollectingLog extends LogPort {
  readonly entries: LogEntry[] = []
  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const SET: BranchSet = {
  repoPath: '/w',
  head: 'aaa111',
  branches: [{ name: 'main', sha: 'aaa111', pushRemote: null }],
  worktrees: [{ path: '/w', branch: 'main', sha: 'aaa111', detached: false }],
  remotes: [{ name: 'origin', url: 'git@github.com:acme/app.git' }],
  checkouts: ['main'],
}

const gitGroup: DaemonGroupFactory = () => ({
  name: 'git',
  ops: [
    defineOp({
      op: 'git.read',
      run: async ({ op }) => ({ ...SET, repoPath: op.repoPath }),
    }),
  ],
})

const readingDaemon = (): Promise<InMemoryDaemon> =>
  createInMemoryDaemon({
    version: 'test',
    sandboxName: SANDBOX,
    secret: SECRET,
    groups: () => [gitGroup],
  })

type TakeoverLine = { branchesMs?: number; afterFirstStepMs?: number }

const takeoverLineOf = (log: CollectingLog, message: string): TakeoverLine | undefined =>
  log.entries.find((entry) => entry.source === 'holder.takeover' && entry.message.includes(message))
    ?.data as TakeoverLine | undefined

const eventsOf = async (rig: HolderRig): Promise<{ type: string; seq: number }[]> =>
  (await rig.plane.readEvents({ threadId: THREAD_ID, afterSeq: 0, limit: 1000, visible: false }))
    .events

const hasEvent = async (rig: HolderRig, type: string): Promise<boolean> =>
  (await eventsOf(rig)).some((event) => event.type === type)

describe('SessionHolder take-over', () => {
  it('loads the record while the runtime config is still resolving', async () => {
    const gate = Promise.withResolvers<void>()
    const rig = await makeRig({ runtimeGate: gate.promise })
    await seedSession(rig)
    let recordLoads = 0
    const readEvents = rig.plane.readEvents.bind(rig.plane)
    rig.plane.readEvents = (params) => {
      recordLoads += 1
      return readEvents(params)
    }
    await rig.holder.start()
    await rig.wake()
    const overlapped = await flushUntil({ check: () => recordLoads > 0 })
    expect(overlapped).toBe(true)
    expect(rig.runtimes).toHaveLength(0)
    gate.resolve()
    await rig.post('go')
    await rig.wake()
    const done = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(done).toBe(true)
  })

  it('takes over in about the slower of config and record, not their sum', async () => {
    const runtimeDelay = 400
    const recordDelay = 300
    const log = new CollectingLog()
    const clock = new FakeClock()
    const sleep = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        clock.setTimeout(resolve, ms)
      })
    const rig = await makeRig({
      log,
      clock,
      beforeRuntime: () => sleep(runtimeDelay),
    })
    await seedSession(rig)
    const readEvents = rig.plane.readEvents.bind(rig.plane)
    rig.plane.readEvents = async (params) => {
      await sleep(recordDelay)
      return readEvents(params)
    }
    await rig.holder.start()
    await rig.post('go')
    await rig.wake()
    const logged = (): boolean => log.entries.some((entry) => entry.source === 'holder.takeover')
    for (let step = 0; step < 20 && !logged(); step += 1) {
      await rig.flush()
      clock.advance(50)
    }
    await flushUntil({ check: logged })
    const line = log.entries.find((entry) => entry.source === 'holder.takeover')
    expect(line?.data).toMatchObject({
      source: 'holder.takeover',
      sessionId: SESSION,
      claimMs: 0,
      configMs: runtimeDelay,
      recordMs: recordDelay,
      settleMs: expect.any(Number),
      commandsMs: expect.any(Number),
      decideMs: expect.any(Number),
    })
    const firstStepMs = Number((line?.data as { firstStepMs?: number } | undefined)?.firstStepMs)
    expect(firstStepMs).toBeGreaterThanOrEqual(runtimeDelay)
    expect(firstStepMs).toBeLessThan(runtimeDelay + recordDelay)
  })

  it('starts the handed-over session turn before the branch observation resolves', async () => {
    const log = new CollectingLog()
    const a = await makeRig({
      daemon: await readingDaemon(),
      script: [{ text: 'first' }],
      watchedRepos: async () => ['/w'],
    })
    await seedSession(a)
    await a.holder.start()
    await a.post('first message')
    await a.wake()
    expect(await flushUntil({ check: () => hasEvent(a, 'branches-observed') })).toBe(true)
    expect(await flushUntil({ check: () => hasEvent(a, 'assistant-said') })).toBe(true)

    await a.holder.drain()
    const handedOverAt = (await eventsOf(a)).at(-1)?.seq ?? 0

    const b = await makeRig({
      plane: a.plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      script: [{ text: 'second' }],
      watchedRepos: () => new Promise<readonly string[]>(() => {}),
      log,
    })
    await b.holder.start()
    await a.post('after the deploy')
    await a.wake()

    const answered = await flushUntil({
      check: async () =>
        (await eventsOf(b)).some(
          (event) => event.type === 'assistant-said' && event.seq > handedOverAt,
        ),
      attempts: 600,
    })
    expect(answered).toBe(true)
    expect(typeof takeoverLineOf(log, 'reached its first step')?.branchesMs).toBe('number')
    expect(log.entries.some((entry) => entry.message.includes('after the first step'))).toBe(false)
  }, 15_000)
})
