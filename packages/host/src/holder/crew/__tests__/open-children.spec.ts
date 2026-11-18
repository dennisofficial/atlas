import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  chainHash,
  EAgentStart,
  EAgentStatus,
  EKilledBy,
  GENESIS_HASH,
  toRunId,
  toThreadId,
  type LogHead,
  type RunId,
  type ThreadId,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'
import { SequentialIds } from '@dltech/atlas-agent/testing'

import type { SessionRecord } from '../../record/record-adapter'
import { settleOpenChildren } from '../open-children'

const PARENT = toThreadId('thread-parent')
const FIRST = toThreadId('thread-child-1')
const SECOND = toThreadId('thread-child-2')
const AT = '2026-01-01T00:00:00.000Z'

const spawned = (agentId: ThreadId): V2Body => ({
  type: 'agent-spawned',
  agentId,
  agentType: 'builder',
  intent: 'build it',
  mode: EAgentStart.Fresh,
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

type ParentLog = { record: SessionRecord; appends: V2Body[][]; events: V2Event[] }

const parentLogOf = (bodies: readonly V2Body[]): ParentLog => {
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
  return { record, appends, events }
}

const settle = async (log: ParentLog): Promise<number> =>
  settleOpenChildren({ record: log.record, ids: new SequentialIds(), threadId: PARENT })

describe('settling the children a boot finds open', () => {
  it('ends a spawn with no ending, once', async () => {
    const log = parentLogOf([spawned(FIRST)])

    expect(await settle(log)).toBe(1)
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

    expect(await settle(log)).toBe(0)
    expect(log.appends).toHaveLength(1)
  })

  it('leaves a child that already ended alone', async () => {
    const log = parentLogOf([spawned(FIRST), ended(FIRST)])

    expect(await settle(log)).toBe(0)
    expect(log.appends).toEqual([])
  })

  it('ends two open children with one ending each', async () => {
    const log = parentLogOf([spawned(FIRST), spawned(SECOND)])

    expect(await settle(log)).toBe(2)
    expect(log.appends.flat()).toMatchObject([
      { type: 'agent-ended', agentId: FIRST },
      { type: 'agent-ended', agentId: SECOND },
    ])
  })
})
