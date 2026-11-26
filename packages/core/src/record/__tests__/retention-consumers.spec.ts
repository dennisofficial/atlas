import { describe, expect, it } from 'bun:test'

import { EAgentStart } from '../../agents/start'
import { EAgentStatus } from '../../agents/status'
import { EResumePoint } from '../../events/body'
import { toCallId } from '../../events/ids'
import { ERunFailureKind } from '../../events/run-failure'
import { EModelWaitCause } from '../../model-recovery/waiting'
import { credentialEpisode } from '../../model-recovery/__tests__/waiting-fixtures'
import { projectWaiting } from '../../model-recovery/waiting-projector'
import { credentialRepairOf } from '../../repair/repair-episode'
import { chainEvents } from '../chain-events'
import type { RecordEvent, RecordEventBody } from '../event'
import { retainedOf } from '../retention'
import { resumePointOf } from '../resume-point'
import { ETurnCause, ETurnEndedBy, ETurnOutcome } from '../turns'
import { NOW, runId, threadId } from './support'

const log = (bodies: RecordEventBody[]) =>
  chainEvents({ threadId, runId, epoch: 1, at: NOW, bodies })

const padding = (count: number): RecordEventBody[] =>
  Array.from({ length: count }, () => ({ type: 'context-changed', paths: ['pad.md'] }))

const beforeOf = (events: readonly RecordEvent[]): number => events.at(-200)?.seq ?? 0

const waitEpisodeOf = (generation: number) => credentialEpisode({ accountId: 'a1', generation })

type WaitEvent = Extract<RecordEvent, { type: 'model-waiting' | 'model-wait-cleared' }>

const waitsOf = (events: readonly RecordEvent[]): WaitEvent[] =>
  events.filter(
    (event): event is WaitEvent =>
      event.type === 'model-waiting' || event.type === 'model-wait-cleared',
  )

const waiting = (generation: number): RecordEventBody => ({
  type: 'model-waiting',
  waiting: {
    episode: waitEpisodeOf(generation),
    cause: EModelWaitCause.Availability,
    providerId: 'anthropic',
    accountId: null,
    modelId: null,
    reason: null,
    resetAt: null,
    affectedThreadIds: [threadId],
  },
})

const cleared = (generation: number): RecordEventBody => ({
  type: 'model-wait-cleared',
  episode: waitEpisodeOf(generation),
  cause: EModelWaitCause.Availability,
})

const failure = { kind: ERunFailureKind.Auth, message: 'signed out' } as const

const agentSpawned: RecordEventBody = {
  type: 'agent-spawned',
  agentId: threadId,
  agentType: 'explore',
  intent: 'look',
  mode: EAgentStart.Fresh,
}

const agentFailed = (): RecordEventBody => ({
  type: 'agent-ended',
  agentId: threadId,
  agentType: 'explore',
  intent: 'look',
  status: EAgentStatus.Failed,
  prose: 'signed out',
  failure,
  turns: 1,
  toolCalls: 1,
})

describe('retained model waits', () => {
  it('keeps a wait that follows a cleared generation', () => {
    const events = log([waiting(1), cleared(1), waiting(2), ...padding(200)])
    const retained = retainedOf({ events, before: beforeOf(events) })
    expect(projectWaiting(waitsOf(retained))).toEqual(projectWaiting(waitsOf(events)))
  })

  it('keeps a wait that a stale clear does not clear', () => {
    const events = log([waiting(2), cleared(1), ...padding(200)])
    const retained = retainedOf({ events, before: beforeOf(events) })
    expect(projectWaiting(waitsOf(retained))).toEqual(projectWaiting(waitsOf(events)))
  })
})

describe('retained rewinds', () => {
  it('hides the events a rewind hides, so the resume point matches', () => {
    const events = log([
      { type: 'turn-started', turnId: 't1', cause: ETurnCause.Input },
      { type: 'tool-called', callId: toCallId('c1'), name: 'bash', ordinal: 0 },
      { type: 'history-rewound', toSeq: 1 },
      ...padding(201),
      {
        type: 'turn-ended',
        turnId: 't1',
        outcome: ETurnOutcome.Stopped,
        by: ETurnEndedBy.Operator,
      },
    ])
    const retained = retainedOf({ events, before: beforeOf(events) })
    expect(resumePointOf({ events: retained })).toEqual(resumePointOf({ events }))
  })
})

describe('retained failures', () => {
  const repairOf = (events: readonly RecordEvent[]) =>
    credentialRepairOf({ mainThreadId: threadId, events })

  it('keeps the dismissal of a failed sub-agent', () => {
    const closed = log([
      agentSpawned,
      agentFailed(),
      { type: 'run-failure-dismissed', failureSeq: 2 },
      ...padding(200),
    ])
    expect(repairOf(retainedOf({ events: closed, before: beforeOf(closed) }))).toEqual(
      repairOf(closed),
    )
  })

  it('keeps the message that clears a failed sub-agent', () => {
    const events = log([
      agentSpawned,
      agentFailed(),
      { type: 'user-said', text: 'go' },
      ...padding(200),
    ])
    expect(repairOf(retainedOf({ events, before: beforeOf(events) }))).toEqual(repairOf(events))
  })

  it('keeps a sub-agent failure nothing clears', () => {
    const events = log([agentSpawned, agentFailed(), ...padding(200)])
    expect(repairOf(retainedOf({ events, before: beforeOf(events) }))).toEqual(repairOf(events))
  })
})

describe('retained stopped turns', () => {
  const stoppedTurn = (interrupted: boolean): RecordEventBody[] => [
    { type: 'turn-started', turnId: 't1', cause: ETurnCause.Input },
    { type: 'tool-called', callId: toCallId('c1'), name: 'bash', ordinal: 0 },
    { type: 'tool-result', callId: toCallId('c1'), name: 'bash', interrupted },
    { type: 'turn-ended', turnId: 't1', outcome: ETurnOutcome.Stopped, by: ETurnEndedBy.Operator },
  ]

  it('keeps every event of the newest stopped turn', () => {
    const events = log([...stoppedTurn(true), ...padding(201)])
    const retained = retainedOf({ events, before: beforeOf(events) })
    expect(resumePointOf({ events: retained })).toEqual({
      kind: EResumePoint.ToolInterrupted,
      callIds: ['c1'],
    })
    expect(resumePointOf({ events: retained })).toEqual(resumePointOf({ events }))
  })

  it('keeps nothing extra when the newest turn completed', () => {
    const events = log([
      { type: 'turn-started', turnId: 't1', cause: ETurnCause.Input },
      { type: 'tool-called', callId: toCallId('c1'), name: 'bash', ordinal: 0 },
      { type: 'tool-result', callId: toCallId('c1'), name: 'bash' },
      { type: 'turn-ended', turnId: 't1', outcome: ETurnOutcome.Completed, by: ETurnEndedBy.Agent },
      ...padding(201),
    ])
    const kept = retainedOf({ events, before: beforeOf(events) }).map((event) => event.type)
    expect(kept).not.toContain('tool-called')
    expect(kept).not.toContain('tool-result')
  })
})
