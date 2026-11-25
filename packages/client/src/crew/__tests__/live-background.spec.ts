import { describe, expect, it } from 'bun:test'

import { toEventId, toRunId, toThreadId, type RecordEvent } from '@dltech/atlas-core'

import { liveBackgroundOf } from '../journal-activity'

const threadId = toThreadId('thread-live')
const childId = toThreadId('thread-child')

let sequence = 0

const eventOf = (body: Record<string, unknown>): RecordEvent => {
  sequence += 1
  return {
    ...body,
    threadId,
    runId: toRunId('run-1'),
    depth: 0,
    id: toEventId(`event-${sequence}`),
    seq: sequence,
    epoch: 0,
    prevHash: '0'.repeat(64),
    at: '2026-01-01T00:00:00.000Z',
  } as RecordEvent
}

const spawned = (): RecordEvent =>
  eventOf({
    type: 'agent-spawned',
    agentId: childId,
    agentType: 'explore',
    intent: 'map',
    mode: 'background',
  })

describe('what a session with no live pod claims is still running', () => {
  it('reads nothing while no pod is live', () => {
    expect(liveBackgroundOf({ events: [spawned()], live: false })).toEqual({
      subagents: 0,
      shells: 0,
    })
  })

  it('reads the journal once a pod is live', () => {
    expect(liveBackgroundOf({ events: [spawned()], live: true })).toEqual({
      subagents: 1,
      shells: 0,
    })
  })
})
