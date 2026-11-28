import { describe, expect, it } from 'bun:test'

import { EAgentStatus } from '@dltech/atlas-core'

import { isActiveCrewStatus, orderedCrewRows, type CrewRow } from '..'

const rowOf = (overrides: Partial<CrewRow>): CrewRow => ({
  agentId: 'agent',
  agentType: 'explore',
  intent: 'Read the tree',
  status: EAgentStatus.Running,
  turns: 0,
  toolCalls: 0,
  startedAt: '2026-11-28T10:00:00.000Z',
  ...overrides,
})

const idsOf = (rows: readonly CrewRow[]) => orderedCrewRows(rows).map((row) => row.agentId)

describe('orderedCrewRows', () => {
  it('puts running, waiting, blocked and paused ahead of every ending', () => {
    const statuses = [
      EAgentStatus.Finished,
      EAgentStatus.Paused,
      EAgentStatus.Failed,
      EAgentStatus.Blocked,
      EAgentStatus.WaitingForModel,
      EAgentStatus.Stopped,
      EAgentStatus.Running,
    ]
    expect(idsOf(statuses.map((status) => rowOf({ status, agentId: status })))).toEqual([
      'running',
      'waiting-for-model',
      'blocked',
      'paused',
      'finished',
      'failed',
      'stopped',
    ])
  })

  it('sorts active rows in each status by newest start without mutating the input', () => {
    const rows = [
      rowOf({ agentId: 'old', startedAt: '2026-11-27T10:00:00.000Z' }),
      rowOf({ agentId: 'new' }),
      rowOf({ agentId: 'same-time' }),
    ]
    expect(idsOf(rows)).toEqual(['new', 'same-time', 'old'])
    expect(rows.map((row) => row.agentId)).toEqual(['old', 'new', 'same-time'])
  })

  it('sorts ended rows together by end, falling back to start and breaking ties by start', () => {
    expect(
      idsOf([
        rowOf({
          agentId: 'old-end',
          status: EAgentStatus.Finished,
          endedAt: '2026-11-28T09:00:00.000Z',
        }),
        rowOf({
          agentId: 'new-end-old-start',
          status: EAgentStatus.Failed,
          startedAt: '2026-11-27T10:00:00.000Z',
          endedAt: '2026-11-28T11:00:00.000Z',
        }),
        rowOf({ agentId: 'no-end', status: EAgentStatus.Stopped }),
        rowOf({
          agentId: 'new-end-new-start',
          status: EAgentStatus.Finished,
          endedAt: '2026-11-28T11:00:00.000Z',
        }),
      ]),
    ).toEqual(['new-end-new-start', 'new-end-old-start', 'no-end', 'old-end'])
  })
})

it('identifies exactly the four active statuses', () => {
  expect(Object.values(EAgentStatus).filter(isActiveCrewStatus)).toEqual([
    EAgentStatus.Running,
    EAgentStatus.Blocked,
    EAgentStatus.Paused,
    EAgentStatus.WaitingForModel,
  ])
})
