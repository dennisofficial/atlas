import { describe, expect, it } from 'bun:test'

import { SequentialIds } from '@dltech/atlas-agent/testing'

import { RIG_MODEL_CHOICE } from '../../__tests__/rig-runtime'

import {
  EAgentRestart,
  EAgentStart,
  EAgentStatus,
  ERunFailureKind,
  GENESIS_HASH,
  chainEvents,
  chainHash,
  toCallId,
  toRunId,
  toThreadId,
  type Event,
  type LogHead,
  type RunId,
  type ThreadId,
  type RecordEventBody,
  type RecordEvent,
} from '@dltech/atlas-core'
import type { HeldSessionDeps } from '../../held-session-deps'
import type { SessionRuntime } from '../../ports'
import type { SessionRecord } from '../../record/record-adapter'
import { CrewRoom } from '../crew-room'
import { openChildrenOf } from '../open-children'

const PARENT = toThreadId('thread-parent')
const FIRST = toThreadId('thread-child-1')
const SECOND = toThreadId('thread-child-2')
const AT = '2026-01-01T00:00:00.000Z'

const spawned = (args: {
  agentId: ThreadId
  group?: string | undefined
  callId?: string | undefined
  worktree?: { path: string; branch: string } | undefined
}): RecordEventBody => ({
  agentId: args.agentId,
  type: 'agent-spawned',
  agentType: 'builder',
  intent: 'build it',
  mode: EAgentStart.Fresh,
  ...(args.group === undefined ? {} : { group: args.group }),
  ...(args.callId === undefined ? {} : { callId: args.callId }),
  ...(args.worktree === undefined ? {} : { worktree: args.worktree }),
})

const ended = (agentId: ThreadId): RecordEventBody => ({
  type: 'agent-ended',
  agentId,
  agentType: 'builder',
  intent: 'build it',
  status: EAgentStatus.Finished,
  prose: 'done',
  turns: 1,
  toolCalls: 2,
})

const headOf = (events: readonly RecordEvent[]): LogHead => {
  const last = events[events.length - 1]
  return last === undefined
    ? { seq: 0, hash: GENESIS_HASH }
    : { seq: last.seq, hash: chainHash(last) }
}

const parentRecordOf = (
  bodies: readonly RecordEventBody[],
): { record: SessionRecord; appends: RecordEventBody[][] } => {
  const events: RecordEvent[] = chainEvents({
    threadId: PARENT,
    runId: toRunId('run-seed'),
    epoch: 1,
    bodies,
    at: AT,
  })
  const appends: RecordEventBody[][] = []
  const record = {
    ownEvents: async () => [...events],
    eventCache: () => ({ eventsAfter: () => [...events] }),
    append: async (args: {
      threadId: ThreadId
      runId: RunId
      drafts: readonly RecordEventBody[]
    }) => {
      appends.push([...args.drafts])
      events.push(
        ...chainEvents({
          threadId: args.threadId,
          runId: args.runId,
          epoch: 1,
          bodies: args.drafts,
          from: headOf(events),
          at: AT,
        }),
      )
      return []
    },
  } as unknown as SessionRecord
  return { record, appends }
}

const childrenOf = async (bodies: readonly RecordEventBody[]) =>
  openChildrenOf((await parentRecordOf(bodies).record.ownEvents({ threadId: PARENT })) as Event[])

const crewOf = (args: { record: SessionRecord; plane: undefined; posted: string[] }): CrewRoom =>
  new CrewRoom({
    deps: {
      sessionId: 'session-1',
      ids: new SequentialIds(),
      timers: { now: () => 0 },
      plane: {
        post: async (message: { payload: string }) => {
          args.posted.push(message.payload)
        },
        readInbox: async () => [],
        readEvents: async () => ({ events: [{ seq: 41 }], next: undefined }),
      },
    } as unknown as HeldSessionDeps,
    runtime: {
      choiceFor: () => RIG_MODEL_CHOICE,
      modelChoice: RIG_MODEL_CHOICE,
    } as unknown as SessionRuntime,
    parentRecord: args.record,
    parentThreadId: PARENT,
    epoch: 1,
    signal: new AbortController().signal,
    onLeaseLost: () => undefined,
  })

describe('adopting the children a takeover finds open', () => {
  it('names every spawn with no ending, worktree and spawn time included', async () => {
    const children = await childrenOf([
      spawned({ agentId: FIRST, worktree: { path: '/work/tree', branch: 'dennis/tree' } }),
      spawned({ agentId: SECOND }),
    ])

    expect(children).toEqual([
      {
        agentId: FIRST,
        agentType: 'builder',
        intent: 'build it',
        group: undefined,
        spawnedAt: AT,
        worktree: { path: '/work/tree', branch: 'dennis/tree' },
      },
      {
        agentId: SECOND,
        agentType: 'builder',
        intent: 'build it',
        group: undefined,
        spawnedAt: AT,
        worktree: undefined,
      },
    ])
  })

  it('keeps the group the spawn row recorded, so an adopted child rejoins it', async () => {
    const children = await childrenOf([
      spawned({ agentId: FIRST, group: 'call-1' }),
      spawned({ agentId: SECOND, group: 'call-1' }),
    ])

    expect(children.map((child) => child.group)).toEqual(['call-1', 'call-1'])
  })

  it('leaves a child that already ended out', async () => {
    expect(await childrenOf([spawned({ agentId: FIRST }), ended(FIRST)])).toEqual([])
  })

  it('keeps a child that was restarted after an ending', async () => {
    const children = await childrenOf([
      spawned({ agentId: FIRST }),
      ended(FIRST),
      spawned({ agentId: FIRST }),
      {
        type: 'agent-restarted',
        agentId: FIRST,
        agentType: 'builder',
        intent: 'build it',
        via: EAgentRestart.Message,
      },
    ])

    expect(children.map((child) => child.agentId)).toEqual([FIRST])
  })

  it('keeps a child whose spawn call was answered', async () => {
    const children = await childrenOf([
      spawned({ agentId: FIRST, callId: 'call-1' }),
      { type: 'tool-result', callId: toCallId('call-1'), name: 'agent_spawn', output: {} },
    ])

    expect(children.map((child) => child.agentId)).toEqual([FIRST])
  })

  it('leaves out a child whose spawn call is still held, so its replay opens it', async () => {
    expect(await childrenOf([spawned({ agentId: FIRST, callId: 'call-1' })])).toEqual([])
  })

  it('keeps a child whose spawn recorded no call', async () => {
    const children = await childrenOf([spawned({ agentId: FIRST })])

    expect(children.map((child) => child.agentId)).toEqual([FIRST])
  })
})

describe('a child whose thread cannot be read', () => {
  it('gets the lost ending instead of a resumed turn', async () => {
    const log = parentRecordOf([spawned({ agentId: FIRST })])
    const posted: string[] = []
    const crew = crewOf({ record: log.record, plane: undefined, posted })

    await crew.adoptAll(await childrenOf([spawned({ agentId: FIRST })]))

    expect(posted).toHaveLength(1)
    const payload = JSON.parse(posted[0] ?? '{}')
    expect(payload.clientId).toBe(`agent-ended:${FIRST}:41`)
    expect(payload.event).toMatchObject({
      type: 'agent-ended',
      agentId: FIRST,
      agentType: 'builder',
      intent: 'build it',
      status: EAgentStatus.Failed,
      failureKind: ERunFailureKind.Lost,
      prose: '',
      turns: 0,
      toolCalls: 0,
    })
    expect(payload.event.failureCause).toContain('could not reopen its record')
    expect(log.appends).toEqual([])
    expect(crew.list()).toEqual([])
  })
})
