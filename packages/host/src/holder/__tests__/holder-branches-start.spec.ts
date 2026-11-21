import { describe, expect, it } from 'bun:test'
import { LogPort, type LogEntry } from '@dltech/atlas-observability'

import type { BranchSet } from '@dltech/atlas-protocol'
import { defineOp, type DaemonGroupFactory } from '@dltech/atlas-protocol/engine'
import { createInMemoryDaemon } from '@dltech/atlas-protocol/testing'

import {
  flushUntil,
  makeRig,
  SANDBOX,
  SECRET,
  seedSession,
  THREAD_ID,
  type HolderRig,
} from './holder-rig'

class CollectingLog extends LogPort {
  readonly entries: LogEntry[] = []
  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const takeoverTailOf = (log: CollectingLog): LogEntry | undefined =>
  log.entries.find((entry) => entry.message.includes('after the first step'))

const SET: BranchSet = {
  repoPath: '/w',
  head: 'aaa111',
  branches: [{ name: 'main', sha: 'aaa111', pushRemote: null }],
  worktrees: [{ path: '/w', branch: 'main', sha: 'aaa111', detached: false }],
  remotes: [{ name: 'origin', url: 'git@github.com:acme/app.git' }],
  checkouts: ['main'],
}

type ReadState = {
  reads: number
  head: string
  branches: readonly string[]
  failFirst: boolean
}

const stateOf = (failFirst: boolean): ReadState => ({
  reads: 0,
  head: 'aaa111',
  branches: ['main'],
  failFirst,
})

const setOf = (state: ReadState): BranchSet => ({
  ...SET,
  head: state.head,
  branches: state.branches.map((name) => ({
    name,
    sha: name === 'main' ? 'aaa111' : 'bbb222',
    pushRemote: null,
  })),
})

const gitGroupOf =
  (state: ReadState): DaemonGroupFactory =>
  () => ({
    name: 'git',
    ops: [
      defineOp({
        op: 'git.read',
        run: async ({ op }) => {
          state.reads += 1
          if (state.failFirst && state.reads === 1) throw new Error('git read failed')
          return { ...setOf(state), repoPath: op.repoPath }
        },
      }),
    ],
  })

const readingDaemon = (state: ReadState) =>
  createInMemoryDaemon({
    version: 'test',
    sandboxName: SANDBOX,
    secret: SECRET,
    groups: () => [gitGroupOf(state)],
  })

const typesOf = async (rig: HolderRig): Promise<string[]> =>
  (await rig.events()).map((event) => event.type)

type BranchRecord = { base: string | null; branches: readonly string[] }

const branchRecordsOf = async (rig: HolderRig): Promise<BranchRecord[]> => {
  const page = await rig.plane.readEvents({
    threadId: THREAD_ID,
    afterSeq: 0,
    limit: 100,
    visible: false,
  })
  return page.events.flatMap((event) =>
    event.type === 'branches-observed'
      ? [{ base: event.base ?? null, branches: event.branches.map((branch) => branch.name) }]
      : [],
  )
}

const baseFactsOf = async (rig: HolderRig): Promise<unknown[]> => {
  const page = await rig.plane.readEvents({
    threadId: THREAD_ID,
    afterSeq: 0,
    limit: 100,
    visible: false,
  })
  return page.events.flatMap((event) =>
    event.type === 'fact-recorded' && event.key === 'base:/w' ? [event.value] : [],
  )
}

const flipToAgentBranch = (state: ReadState): void => {
  state.head = 'feat-x'
  state.branches = ['feat-x', 'main']
}

describe('the boot branch observation', () => {
  it('holds the first turn until it is recorded', async () => {
    let open: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const rig = await makeRig({
      daemon: await readingDaemon(stateOf(false)),
      script: [{ text: 'made it' }],
      watchedRepos: () => gate.then(() => ['/w']),
      baseBranches: { '/w': 'main' },
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('go')
    await rig.wake()
    await rig.flush()
    expect(rig.runtimes).toHaveLength(1)
    expect(await typesOf(rig)).not.toContain('assistant-said')

    open()
    const said = await flushUntil({
      check: async () => (await typesOf(rig)).includes('assistant-said'),
    })
    expect(said).toBe(true)
    const types = await typesOf(rig)
    expect(types).toContain('branches-observed')
    expect(types.indexOf('branches-observed')).toBeLessThan(types.indexOf('assistant-said'))
    rig.holder.discard()
  })

  it('starts the turn on the refresh cap and keeps the prepared base', async () => {
    let open: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const state = stateOf(false)
    const log = new CollectingLog()
    const rig = await makeRig({
      daemon: await readingDaemon(state),
      script: [{ text: 'made the branch' }],
      watchedRepos: () => gate.then(() => ['/w']),
      baseBranches: { '/w': 'main' },
      log,
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('go')
    await rig.wake()
    await rig.flush()
    expect(rig.runtimes).toHaveLength(1)
    expect(await typesOf(rig)).not.toContain('assistant-said')

    const said = await flushUntil({
      check: async () => (await typesOf(rig)).includes('assistant-said'),
      clock: rig.clock,
      attempts: 10,
      advanceMs: 10_000,
    })
    expect(said).toBe(true)

    flipToAgentBranch(state)
    open()
    const observed = await flushUntil({
      check: async () => (await branchRecordsOf(rig)).length > 0,
    })
    expect(observed).toBe(true)
    const records = await branchRecordsOf(rig)
    expect(records.map((row) => row.base)).toEqual(records.map(() => 'main'))
    expect(records.at(-1)?.branches).toContain('feat-x')
    expect(await baseFactsOf(rig)).toEqual([])
    const tail = takeoverTailOf(log)
    expect(tail?.data).toMatchObject({
      branchesMs: expect.any(Number),
      afterFirstStepMs: expect.any(Number),
    })
    rig.holder.discard()
  })

  it('keeps the prepared base when the first read fails', async () => {
    const state = stateOf(true)
    const rig = await makeRig({
      daemon: await readingDaemon(state),
      script: [{ text: 'made the branch' }],
      watchedRepos: async () => ['/w'],
      baseBranches: { '/w': 'main' },
    })
    await seedSession(rig)
    await rig.holder.start()
    const failed = await flushUntil({ check: async () => state.reads > 0 })
    expect(failed).toBe(true)
    flipToAgentBranch(state)

    await rig.post('go')
    await rig.wake()
    const said = await flushUntil({
      check: async () => (await typesOf(rig)).includes('assistant-said'),
    })
    expect(said).toBe(true)
    const observed = await flushUntil({
      check: async () => (await branchRecordsOf(rig)).length > 0,
    })
    expect(observed).toBe(true)
    const records = await branchRecordsOf(rig)
    expect(records.map((row) => row.base)).toEqual(records.map(() => 'main'))
    expect(records.at(-1)?.branches).toContain('feat-x')
    rig.holder.discard()
  })

  it('records no base when none is known rather than guess one', async () => {
    const state = stateOf(true)
    const rig = await makeRig({
      daemon: await readingDaemon(state),
      script: [{ text: 'made the branch' }],
      watchedRepos: async () => ['/w'],
    })
    await seedSession(rig)
    await rig.holder.start()
    const failed = await flushUntil({ check: async () => state.reads > 0 })
    expect(failed).toBe(true)
    flipToAgentBranch(state)

    await rig.post('go')
    await rig.wake()
    const said = await flushUntil({
      check: async () => (await typesOf(rig)).includes('assistant-said'),
    })
    expect(said).toBe(true)
    const observed = await flushUntil({
      check: async () => (await branchRecordsOf(rig)).length > 0,
    })
    expect(observed).toBe(true)
    const records = await branchRecordsOf(rig)
    expect(records.map((row) => row.base)).toEqual(records.map(() => null))
    expect(await baseFactsOf(rig)).toEqual([])
    rig.holder.discard()
  })
})
