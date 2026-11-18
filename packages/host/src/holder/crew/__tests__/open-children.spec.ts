import { describe, expect, it } from 'bun:test'

import { SequentialIds } from '@dltech/atlas-agent/testing'

import { RIG_MODEL_CHOICE } from '../../__tests__/rig-runtime'

import {
  EAgentRestart,
  EAgentStart,
  EKilledBy,
  EAgentStatus,
  GENESIS_HASH,
  chainEvents,
  chainHash,
  toRunId,
  toThreadId,
  type Event,
  type LogHead,
  type RunId,
  type ThreadId,
  type V2Body,
  type V2Event,
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
  worktree?: { path: string; branch: string } | undefined
}): V2Body => ({
  agentId: args.agentId,
  type: 'agent-spawned',
  agentType: 'builder',
  intent: 'build it',
  mode: EAgentStart.Fresh,
  ...(args.worktree === undefined ? {} : { worktree: args.worktree }),
})

const ended = (agentId: ThreadId): V2Body => ({
  type: 'agent-ended',
  agentId,
  agentType: 'builder',
  intent: 'build it',
  status: EAgentStatus.Finished,
  prose: 'done',
  turns: 1,
  toolCalls: 2,
})

const headOf = (events: readonly V2Event[]): LogHead => {
  const last = events[events.length - 1]
  return last === undefined
    ? { seq: 0, hash: GENESIS_HASH }
    : { seq: last.seq, hash: chainHash(last) }
}

const parentRecordOf = (
  bodies: readonly V2Body[],
): { record: SessionRecord; appends: V2Body[][] } => {
  const events: V2Event[] = chainEvents({
    threadId: PARENT,
    runId: toRunId('run-seed'),
    epoch: 1,
    bodies,
    at: AT,
  })
  const appends: V2Body[][] = []
  const record = {
    ownEvents: async () => [...events],
    append: async (args: { threadId: ThreadId; runId: RunId; drafts: readonly V2Body[] }) => {
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

const childrenOf = async (bodies: readonly V2Body[]) =>
  openChildrenOf((await parentRecordOf(bodies).record.ownEvents({ threadId: PARENT })) as Event[])

const crewOf = (args: { record: SessionRecord; plane: undefined }): CrewRoom =>
  new CrewRoom({
    deps: {
      sessionId: 'session-1',
      ids: new SequentialIds(),
      timers: { now: () => 0 },
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
        spawnedAt: AT,
        worktree: { path: '/work/tree', branch: 'dennis/tree' },
      },
      {
        agentId: SECOND,
        agentType: 'builder',
        intent: 'build it',
        spawnedAt: AT,
        worktree: undefined,
      },
    ])
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
})

describe('a child whose thread cannot be read', () => {
  it('gets the lost ending instead of a resumed turn', async () => {
    const log = parentRecordOf([spawned({ agentId: FIRST })])
    const crew = crewOf({ record: log.record, plane: undefined })

    await crew.adoptAll(await childrenOf([spawned({ agentId: FIRST })]))

    expect(log.appends).toEqual([
      [
        {
          type: 'agent-ended',
          agentId: FIRST,
          agentType: 'builder',
          intent: 'build it',
          status: EAgentStatus.Stopped,
          killedBy: EKilledBy.Unrecorded,
          prose: '',
          turns: 0,
          toolCalls: 0,
        },
      ],
    ])
    expect(crew.list()).toEqual([])
  })
})
