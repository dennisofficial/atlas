import { describe, expect, test } from 'bun:test'

import { EAgentStatus, EShellStatus } from '@dltech/atlas-core'
import type { CrewRow } from '@dltech/atlas-plugin-crew/client'

import { crewMemberRowsOf, crewRowsetOf, crewSidebarRowsOf } from '../crew-rows'

const rowOf = (patch: Partial<CrewRow>): CrewRow => ({
  agentId: 'agent-1',
  agentType: 'general-purpose',
  intent: 'read the tree',
  status: EAgentStatus.Running,
  turns: 1,
  toolCalls: 2,
  startedAt: new Date(Date.now() - 5_000).toISOString(),
  ...patch,
})

const rowsFor = (rows: readonly CrewRow[], viewing: string | null) =>
  crewSidebarRowsOf({
    rows,
    now: Date.now(),
    viewing,
    shells: [],
    children: [],
  })

describe('crewRowsetOf', () => {
  test('splits the teammate type out of the ring', () => {
    const rowset = crewRowsetOf([
      rowOf({ agentId: 'agent-1' }),
      rowOf({ agentId: 'agent-2', agentType: 'teammate' }),
    ])

    expect(rowset.subagents.map((row) => row.agentId)).toEqual(['agent-1'])
    expect(rowset.teammates.map((row) => row.agentId)).toEqual(['agent-2'])
  })
})

describe('crewSidebarRowsOf', () => {
  test('a running child reads as working', () => {
    const [row] = rowsFor([rowOf({})], null)

    expect(row?.state).not.toBe('done')
    expect(row?.failureReason).toBeNull()
    expect(row?.model).toBeNull()
    expect(row?.activity).toBeUndefined()
  })

  test('a failed child carries its prose as the reason', () => {
    const [row] = rowsFor(
      [rowOf({ status: EAgentStatus.Failed, prose: 'the provider refused the key' })],
      null,
    )

    expect(row?.state).toBe('failed')
    expect(row?.failureReason).toBe('the provider refused the key')
  })

  test('a settled child drops its reason, and a finished one spends no state word', () => {
    const [row] = rowsFor([rowOf({ status: EAgentStatus.Finished, prose: 'all tests pass' })], null)

    expect(row?.state).toBe('')
    expect(row?.failureReason).toBeNull()
  })

  test('selected follows the open child', () => {
    const [row] = rowsFor([rowOf({ agentId: 'agent-1' })], 'agent-1')

    expect(row?.selected).toBe(true)
  })

  test('a running shell counts against the child that holds it', () => {
    const [row] = crewSidebarRowsOf({
      rows: [rowOf({ agentId: 'agent-1' })],
      now: Date.now(),
      viewing: null,
      shells: [{ threadId: 'agent-1', status: EShellStatus.Running }],
      children: [],
    })

    expect(row?.activity).toEqual({ shells: 1, subagents: 0 })
  })
})

describe('crewMemberRowsOf', () => {
  test('every row is a child of the open session with its last visit', () => {
    const members = crewMemberRowsOf({
      rows: [rowOf({ agentId: 'agent-1' })],
      lastViewedOf: () => '2026-11-20T00:00:00.000Z',
    })

    expect(members[0]?.spawnedBy).toBe('')
    expect(members[0]?.lastViewedAt).toBe('2026-11-20T00:00:00.000Z')
    expect(members[0]?.holdingShells).toBe(false)
  })
})
