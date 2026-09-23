import { stat } from 'node:fs/promises'

import {
  EAgentStatus,
  EExecutionLocation,
  EKilledBy,
  toThreadId,
  toEventId,
  toRunId,
  type Event,
  type ThreadId,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import {
  atlasDirectory,
  ETurnStatus,
  sessionDirectory,
  sessionLockFile,
  SupervisionTreeTooDeep,
  type AgentRegistryPort,
  type AgentSnapshot,
  type TurnLedgerPort,
  type TurnSpend,
} from '@dltech/atlas-harness'

import { EOpenMode } from '../config'
import { closeConversation, openConversation, type OpenOutcome, type OpenedConversation } from '../open-conversation'
import { fakeAgentRegistry } from './fake-agents'
import { fakeThreadStore, fakeEventLog, fakeIds, fakeLedger, FAKE_WORKSPACE, SPEC_SHARD } from './fake-backend'

const YESTERDAY = toThreadId(`yesterday-${SPEC_SHARD}`)

const HERE: WorkspaceIdentity = { workspace: FAKE_WORKSPACE, repo: null }
const WORKTREE: WorkspaceIdentity = { workspace: '/repo/.claude/worktrees/feature', repo: '/repo' }

const spent: TurnSpend = {
  threadId: YESTERDAY,
  runId: toRunId('r1'),
  status: ETurnStatus.Completed,
  providerId: 'anthropic',
  modelId: 'claude-opus-5',
  steps: 1,
  inputTokens: 1_000,
  outputTokens: 222,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  startedAt: '2026-08-24T00:00:00.000Z',
  endedAt: '2026-08-24T00:00:03.000Z',
  durationMs: 3_000,
}

const FIRST_CHILD = toThreadId(`child-one-${SPEC_SHARD}`)

const SECOND_CHILD = toThreadId(`child-two-${SPEC_SHARD}`)

const A_FORK = toThreadId(`a-fork-of-yesterday-${SPEC_SHARD}`)

const refusingLedger = (): TurnLedgerPort => {
  const held = fakeLedger({ spent: [spent] })

  return {
    record: (row) => held.record(row),
    forThread: ({ threadId }) => held.forThread({ threadId }),
    forThreadTree: async () => {
      throw new SupervisionTreeTooDeep({ threadId: YESTERDAY, limit: 1 })
    },
  }
}

const byChild = (threadId: ThreadId, inputTokens: number): TurnSpend => ({
  ...spent,
  threadId,
  runId: toRunId(`run-${threadId}`),
  inputTokens,
})

const said = (text: string): Event => ({
  type: 'user-said',
  text,
  id: toEventId('e1'),
  seq: 1,
  threadId: YESTERDAY,
  runId: toRunId('r1'),
  depth: 0,
  at: '2026-08-24T00:00:00.000Z',
})

const opened = (outcome: OpenOutcome): OpenedConversation => {
  if (!outcome.ok) throw new Error(`expected an opened conversation, got: ${outcome.reason}`)
  return outcome.conversation
}

describe('which conversation the app opens on', () => {
  it('holds an unstarted conversation by default, writing nothing until something is said', async () => {
    const threads = fakeThreadStore({ existing: [YESTERDAY] })

    const outcome = await openConversation({
      threads,
      log: fakeEventLog([said('do not pollute this')]),
      ledger: fakeLedger({ spent: [spent] }),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.New },
    })

    expect(opened(outcome).threadId).not.toBe(YESTERDAY)
    expect(opened(outcome).events).toEqual([])
    expect(opened(outcome).started).toBe(false)
    expect(threads.created).toBe(0)
  })

  it('continues the most recent one, with everything it already held', async () => {
    const threads = fakeThreadStore({ existing: [toThreadId('older'), YESTERDAY] })

    const outcome = await openConversation({
      threads,
      log: fakeEventLog([said('carry this on')]),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Continue },
    })

    expect(opened(outcome).threadId).toBe(YESTERDAY)
    expect(opened(outcome).events).toHaveLength(1)
    expect(threads.created).toBe(0)
  })

  it('carries what its turns already spent, so the lines are drawn on the first frame', async () => {
    const threads = fakeThreadStore({ existing: [YESTERDAY] })

    const outcome = await openConversation({
      threads,
      log: fakeEventLog([said('carry this on')]),
      ledger: fakeLedger({ spent: [spent] }),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Continue },
    })

    expect(opened(outcome).turns).toEqual([spent])
  })

  it('counts what its sub-agents spent alongside its own, because the counter is the session’s', async () => {
    const threads = fakeThreadStore({ existing: [YESTERDAY] })

    const outcome = await openConversation({
      threads,
      log: fakeEventLog([said('carry this on')]),
      ledger: fakeLedger({
        spent: [spent, byChild(FIRST_CHILD, 4_000), byChild(SECOND_CHILD, 2_000)],
        children: { [YESTERDAY]: [FIRST_CHILD, SECOND_CHILD] },
      }),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Continue },
    })

    expect(opened(outcome).turns).toHaveLength(3)
  })

  it('still opens when the spend rollup refuses to answer, because the transcript is the product', async () => {
    const threads = fakeThreadStore({ existing: [YESTERDAY] })
    const refusing = refusingLedger()

    const outcome = await openConversation({
      threads,
      log: fakeEventLog([said('carry this on')]),
      ledger: refusing,
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Continue },
    })

    expect(opened(outcome).events).toHaveLength(1)
    expect(opened(outcome).turns).toEqual([spent])
  })

  it('holds an unstarted one when there is none to continue, so first run is not an error state', async () => {
    const threads = fakeThreadStore()

    const outcome = await openConversation({
      threads,
      log: fakeEventLog(),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Continue },
    })

    expect(threads.created).toBe(0)
    expect(opened(outcome).started).toBe(false)
    expect(opened(outcome).events).toEqual([])
  })

  it('does not continue a conversation belonging to another workspace', async () => {
    const threads = fakeThreadStore({ existing: [YESTERDAY], workspace: '/elsewhere' })

    const outcome = await openConversation({
      threads,
      log: fakeEventLog([said('another project')]),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Continue },
    })

    expect(opened(outcome).threadId).not.toBe(YESTERDAY)
    expect(opened(outcome).events).toEqual([])
    expect(opened(outcome).started).toBe(false)
    expect(threads.created).toBe(0)
  })

  it('resumes the conversation it was handed by id', async () => {
    const threads = fakeThreadStore({ existing: [toThreadId('older'), YESTERDAY] })

    const outcome = await openConversation({
      threads,
      log: fakeEventLog([said('pick this one')]),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Resume, threadId: 'older' },
    })

    expect(opened(outcome).threadId).toBe(toThreadId('older'))
    expect(threads.created).toBe(0)
  })

  it('refuses an id that does not exist rather than opening something else', async () => {
    const outcome = await openConversation({
      threads: fakeThreadStore({ existing: [YESTERDAY] }),
      log: fakeEventLog(),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Resume, threadId: 'never-was' },
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.reason).toContain('never-was')
  })

  it('resumes a conversation opened in another worktree of the same project', async () => {
    const threads = fakeThreadStore({ existing: [YESTERDAY], workspace: '/repo', repo: '/repo' })

    const outcome = await openConversation({
      threads,
      log: fakeEventLog([said('from the checkout')]),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: WORKTREE,
      effects: () => undefined,
      open: { mode: EOpenMode.Resume, threadId: YESTERDAY },
    })

    expect(opened(outcome).threadId).toBe(YESTERDAY)
    expect(threads.created).toBe(0)
  })

  it('continues the most recent conversation of the project from inside a worktree', async () => {
    const threads = fakeThreadStore({ existing: [YESTERDAY], workspace: '/repo', repo: '/repo' })

    const outcome = await openConversation({
      threads,
      log: fakeEventLog([said('carry this on')]),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: WORKTREE,
      effects: () => undefined,
      open: { mode: EOpenMode.Continue },
    })

    expect(opened(outcome).threadId).toBe(YESTERDAY)
  })

  it('refuses an id from another project even when reached from a worktree', async () => {
    const outcome = await openConversation({
      threads: fakeThreadStore({ existing: [YESTERDAY], workspace: '/other', repo: '/other' }),
      log: fakeEventLog(),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: WORKTREE,
      effects: () => undefined,
      open: { mode: EOpenMode.Resume, threadId: YESTERDAY },
    })

    expect(outcome.ok).toBe(false)
  })

  it('refuses an id belonging to another workspace, however real it is', async () => {
    const outcome = await openConversation({
      threads: fakeThreadStore({ existing: [YESTERDAY], workspace: '/elsewhere' }),
      log: fakeEventLog(),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Resume, threadId: YESTERDAY },
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.reason).toContain(FAKE_WORKSPACE)
  })
  it('resumes by the name the exit line printed, not only by the id', async () => {
    const threads = fakeThreadStore({
      existing: [toThreadId('older'), YESTERDAY],
      titles: { [YESTERDAY]: 'Atlas Daily Driver Setup' },
    })

    const outcome = await openConversation({
      threads,
      log: fakeEventLog([said('the one with a name')]),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Resume, threadId: 'atlas-daily-driver-setup' },
    })

    expect(opened(outcome).threadId).toBe(YESTERDAY)
    expect(threads.created).toBe(0)
  })

  it('resumes by name a conversation that has fallen out of the picker’s window', async () => {
    const newer = Array.from({ length: 50 }, (_, index) => toThreadId(`newer-${index}`))
    const threads = fakeThreadStore({
      existing: [YESTERDAY, ...newer],
      titles: { [YESTERDAY]: 'Atlas Daily Driver Setup' },
    })
    expect(await threads.list({ project: FAKE_WORKSPACE })).toHaveLength(50)

    const outcome = await openConversation({
      threads,
      log: fakeEventLog([said('the one with a name')]),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Resume, threadId: 'atlas-daily-driver-setup' },
    })

    expect(opened(outcome).threadId).toBe(YESTERDAY)
  })

  it('takes the title as it was written, without asking for the slug', async () => {
    const outcome = await openConversation({
      threads: fakeThreadStore({
        existing: [YESTERDAY],
        titles: { [YESTERDAY]: 'Atlas Daily Driver Setup' },
      }),
      log: fakeEventLog([said('the one with a name')]),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Resume, threadId: 'Atlas Daily Driver Setup' },
    })

    expect(opened(outcome).threadId).toBe(YESTERDAY)
  })

  it('resumes by a title only the cloud remembers, when the local row predates the rename', async () => {
    const remote = fakeThreadStore({
      existing: [YESTERDAY],
      titles: { [YESTERDAY]: 'Casual Greeting' },
    })
    await remote.chooseExecutionLocation({
      threadId: YESTERDAY,
      location: EExecutionLocation.Cloud,
    })

    const outcome = await openConversation({
      threads: fakeThreadStore({
        existing: [YESTERDAY],
        titles: { [YESTERDAY]: 'Hello World Greeting' },
      }),
      remoteThreads: remote,
      log: fakeEventLog([said('the renamed one')]),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Resume, threadId: 'casual-greeting' },
    })

    expect(opened(outcome).threadId).toBe(YESTERDAY)
    expect(opened(outcome).executionLocation).toBe(EExecutionLocation.Cloud)
  })

  it('resumes a thread that only exists in the cloud at all', async () => {
    const remote = fakeThreadStore({ existing: [YESTERDAY] })
    await remote.chooseExecutionLocation({
      threadId: YESTERDAY,
      location: EExecutionLocation.Cloud,
    })

    const outcome = await openConversation({
      threads: fakeThreadStore(),
      remoteThreads: remote,
      log: fakeEventLog(),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Resume, threadId: YESTERDAY },
    })

    expect(opened(outcome).threadId).toBe(YESTERDAY)
    expect(opened(outcome).executionLocation).toBe(EExecutionLocation.Cloud)
  })

  it('still says no when neither store knows the conversation', async () => {
    const outcome = await openConversation({
      threads: fakeThreadStore(),
      remoteThreads: fakeThreadStore(),
      log: fakeEventLog(),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Resume, threadId: 'nobody-home' },
    })

    expect(outcome.ok).toBe(false)
  })

  it('resumes one recorded before conversations were attributed to a workspace', async () => {
    const threads = fakeThreadStore({ existing: [YESTERDAY], workspace: null })

    const outcome = await openConversation({
      threads,
      log: fakeEventLog([said('from before the attribution')]),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Resume, threadId: YESTERDAY },
    })

    expect(opened(outcome).threadId).toBe(YESTERDAY)
    expect(opened(outcome).events).toHaveLength(1)
  })

  it('files an unattributed conversation under this workspace, so it is never lost twice', async () => {
    const threads = fakeThreadStore({ existing: [YESTERDAY], workspace: null })

    await openConversation({
      threads,
      log: fakeEventLog([said('from before the attribution')]),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Resume, threadId: YESTERDAY },
    })

    expect(await threads.mostRecent({ project: FAKE_WORKSPACE })).toMatchObject({
      id: YESTERDAY,
    })
  })
})

type Recovery = { threadId: ThreadId; at: number }

const recordingAgents = (args: {
  settled?: readonly AgentSnapshot[]
  onRecord?: () => void
}): { agents: AgentRegistryPort; readonly recoveries: readonly Recovery[] } => {
  const agents = fakeAgentRegistry()
  const recoveries: Recovery[] = []
  let ticks = 0

  agents.recordLostAgents = async ({ threadId }) => {
    ticks += 1
    recoveries.push({ threadId, at: ticks })
    args.onRecord?.()
    return { settled: args.settled ?? [], unlogged: [] }
  }

  return { recoveries, agents }
}

const lostChild = (): AgentSnapshot => ({
  agentId: toThreadId('child-1'),
  spawnedBy: YESTERDAY,
  agentType: 'explore',
  intent: 'count the assemble callers',
  status: EAgentStatus.Stopped,
  killedBy: EKilledBy.Unrecorded,
  turns: 2,
  toolCalls: 5,
  lastTool: 'grep',
  startedAt: '2026-08-24T00:00:00.000Z',
  endedAt: '2026-08-24T00:00:09.000Z',
})

describe('the children the last process lost', () => {
  it('are settled when the conversation is opened, not when it is rendered', async () => {
    const { agents, recoveries } = recordingAgents({ settled: [lostChild()] })

    const outcome = await openConversation({
      threads: fakeThreadStore({ existing: [YESTERDAY] }),
      log: fakeEventLog([said('where did my agent go')]),
      ledger: fakeLedger(),
      agents,
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Continue },
    })

    expect(recoveries.map((one) => one.threadId)).toEqual([YESTERDAY])
    expect(opened(outcome).lost?.settled.map((one) => one.agentId)).toEqual([toThreadId('child-1')])
  })

  it('are settled before the transcript is read, so their endings are in the first frame', async () => {
    const log = fakeEventLog([said('where did my agent go')])
    let readBeforeRecording = false

    const { agents } = recordingAgents({
      onRecord: () => {
        readBeforeRecording = log.branchesRead.length > 0
      },
    })

    await openConversation({
      threads: fakeThreadStore({ existing: [YESTERDAY] }),
      log,
      ledger: fakeLedger(),
      agents,
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Continue },
    })

    expect(readBeforeRecording).toBe(false)
    expect(log.branchesRead).toEqual([YESTERDAY])
  })

  it('are settled once for each opening, which the registry is built to tolerate', async () => {
    const { agents, recoveries } = recordingAgents({})
    const threads = fakeThreadStore({ existing: [YESTERDAY] })

    const open = () =>
      openConversation({
        threads,
        log: fakeEventLog([said('again')]),
        ledger: fakeLedger(),
        agents,
        ids: fakeIds(),
        workspace: HERE,
        effects: () => undefined,
        open: { mode: EOpenMode.Continue },
      })

    await open()
    await open()

    expect(recoveries).toHaveLength(2)
  })

  it('report nothing for a conversation that never spawned one', async () => {
    const outcome = await openConversation({
      threads: fakeThreadStore({ existing: [YESTERDAY] }),
      log: fakeEventLog([said('no agents here')]),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Continue },
    })

    expect(opened(outcome).lost).toEqual({ settled: [], unlogged: [] })
  })
})

describe('the lock a swap leaves behind', () => {
  it('is released once the swap lands on another thread, so the next open claims it fresh', async () => {
    const today = toThreadId(`today-${SPEC_SHARD}`)
    const threads = fakeThreadStore({ existing: [YESTERDAY, today] })
    const open = (threadId: string) =>
      openConversation({
        threads,
        log: fakeEventLog(),
        ledger: fakeLedger(),
        agents: fakeAgentRegistry(),
        ids: fakeIds(),
        workspace: HERE,
        effects: () => undefined,
        open: { mode: EOpenMode.Resume, threadId },
      })

    await open(YESTERDAY)
    await open(today)

    const dir = sessionDirectory({ home: atlasDirectory(), sessionId: YESTERDAY })
    const held = await stat(sessionLockFile({ sessionDir: dir })).then(
      () => true,
      () => false,
    )
    expect(held).toBe(false)
    await closeConversation()
  })
})
