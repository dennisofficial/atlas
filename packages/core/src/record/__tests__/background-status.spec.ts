import { describe, expect, it } from 'bun:test'

import { EAgentStart } from '../../agents/start'
import { EAgentStatus } from '../../agents/status'
import { toEventId, toRunId, toThreadId } from '../../events/ids'
import { EShellStatus } from '../../shells/status'
import { EFinishReason } from '../../stream/chunk'
import type { Hash, V2Body, V2Event } from '../event'
import { ESessionStatus, sessionStatusOf } from '../session-status'

const NOW = '2026-11-19T12:00:00.000Z'
const CHILD = toThreadId('child')

const eventsOf = (bodies: readonly V2Body[]): V2Event[] =>
  bodies.map(
    (body, index) =>
      ({
        ...body,
        id: toEventId(`t:${index + 1}`),
        seq: index + 1,
        threadId: toThreadId('t'),
        runId: toRunId('r'),
        depth: 0,
        at: NOW,
        epoch: 1,
        prevHash: 'a'.repeat(64) as Hash,
      }) as V2Event,
  )

const userSaid: V2Body = { type: 'user-said', text: 'hi' }
const assistantDone: V2Body = { type: 'assistant-said', parts: [], finish: EFinishReason.Stop }
const shellStarted: V2Body = {
  type: 'background-shell-started',
  shellId: 'sh1',
  command: 'sleep 9',
}
const shellEnded: V2Body = {
  type: 'background-shell-ended',
  shellId: 'sh1',
  command: 'sleep 9',
  status: EShellStatus.Exited,
  exitCode: 0,
  output: '',
  droppedCharacters: 0,
  remainingCharacters: 0,
}
const agentSpawned: V2Body = {
  type: 'agent-spawned',
  agentId: CHILD,
  agentType: 'builder',
  intent: 'build',
  mode: EAgentStart.Fresh,
}
const agentEnded: V2Body = {
  type: 'agent-ended',
  agentId: CHILD,
  agentType: 'builder',
  intent: 'build',
  status: EAgentStatus.Finished,
  prose: 'done',
  turns: 1,
  toolCalls: 0,
}

const statusOf = (bodies: readonly V2Body[], live = true) =>
  sessionStatusOf({ events: eventsOf(bodies), live, queuedSince: null, now: NOW }).state

describe('background work in the session status', () => {
  it('waits for background work while a sub-agent runs after the turn ended', () => {
    expect(statusOf([userSaid, agentSpawned, assistantDone])).toBe(
      ESessionStatus.WaitingForBackground,
    )
  })

  it('waits for background work while a shell runs after the turn ended', () => {
    expect(statusOf([userSaid, shellStarted, assistantDone])).toBe(
      ESessionStatus.WaitingForBackground,
    )
  })

  it('goes idle once every background run ended', () => {
    expect(
      statusOf([
        userSaid,
        agentSpawned,
        shellStarted,
        assistantDone,
        agentEnded,
        shellEnded,
        assistantDone,
      ]),
    ).toBe(ESessionStatus.Idle)
  })

  it('keeps the open turn status while the turn runs', () => {
    expect(statusOf([userSaid, agentSpawned])).toBe(ESessionStatus.Thinking)
  })

  it('stays idle when no host holds the session', () => {
    expect(statusOf([userSaid, shellStarted, assistantDone], false)).toBe(ESessionStatus.Idle)
  })
})
