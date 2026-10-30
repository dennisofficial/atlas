import { describe, expect, it } from 'bun:test'

import { EAgentStatus, EShellStatus } from '@dltech/atlas-core'
import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import type { RosterWire } from '@dltech/atlas-wire/web'

import {
  crewGroupsOf,
  crewMembersOf,
  crewRowsOf,
  type CrewEntry,
  type CrewRow,
} from '../crew-model'

const NOW = Date.parse('2026-01-01T00:01:04.000Z')
const STARTED = Date.parse('2026-01-01T00:00:00.000Z')

const entry = (id: string, display: EAgentDisplay, teammate = false): CrewEntry => ({
  id,
  title: id,
  display,
  teammate,
  view: {
    id,
    agentType: 'explore',
    intent: id,
    display,
    live: false,
    startedAt: STARTED + Number(id.replace(/\D/g, '') || 0) * 1000,
    endedAt: undefined,
    model: undefined,
    context: undefined,
    latestCall: undefined,
    report: undefined,
    errorText: display === EAgentDisplay.Failed ? 'boom\n  bad' : undefined,
    toolCalls: 0,
    teammate,
  },
})

const roster = (over: Partial<RosterWire> = {}): RosterWire => ({
  shells: [],
  agents: [],
  services: [],
  ...over,
})

const groupsOf = (entries: CrewEntry[], data: RosterWire | null = null, viewing = null) => {
  const rows = crewRowsOf({ entries, roster: data, viewing, now: NOW })
  const members = crewMembersOf({ rows, roster: data, threadId: 't', visits: new Map() })
  return crewGroupsOf({
    rows,
    members,
    viewing,
    expanded: { subagents: false, teammates: false },
  })
}

describe('crew rows', () => {
  it('orders newest first and keeps the folded tail out of the list', () => {
    const entries = [
      entry('a1', EAgentDisplay.Done),
      entry('a2', EAgentDisplay.Done),
      entry('a3', EAgentDisplay.Done),
      entry('a4', EAgentDisplay.Done),
      entry('a5', EAgentDisplay.Running),
    ]
    const { subagents } = groupsOf(entries, roster(), null)
    expect(subagents.rows.map((r) => r.id)).toEqual(['a5', 'a4', 'a3'])
    expect(subagents.collapsed).toBe(2)
    expect(subagents.working).toBe(1)
    expect(subagents.total).toBe(5)
  })

  it('reads running elapsed, failure reason on one line, and holds an undelivered child', () => {
    const entries = [entry('a1', EAgentDisplay.Running), entry('a2', EAgentDisplay.Failed)]
    const rows: CrewRow[] = crewRowsOf({ entries, roster: null, viewing: null, now: NOW })
    expect(rows[0]?.state).toBe('1m 3s')
    expect(rows[1]?.state).toBe('failed')
    expect(rows[1]?.failure).toBe('boom bad')
  })

  it('shows shell activity and keeps a shell-holding finished child unfolded', () => {
    const entries = ['a1', 'a2', 'a3', 'a4'].map((id) => entry(id, EAgentDisplay.Done))
    const data = roster({
      shells: [{ threadId: 'a1', status: EShellStatus.Running }] as RosterWire['shells'],
      agents: ['a1', 'a2', 'a3', 'a4'].map((id) => ({
        agentId: id,
        spawnedBy: 't',
        status: EAgentStatus.Finished,
        deliveredAt: '2026-01-01T00:00:00.000Z',
      })) as unknown as RosterWire['agents'],
    })
    const { subagents } = groupsOf(entries, data)
    expect(subagents.rows.find((r) => r.id === 'a1')?.activity).toEqual({ shells: 1, subagents: 0 })
    expect(subagents.rows.map((r) => r.id)).toContain('a1')
  })

  it('holds a child whose roster snapshot lacks deliveredAt', () => {
    const entries = ['a1', 'a2', 'a3', 'a4'].map((id) => entry(id, EAgentDisplay.Done))
    const data = roster({
      agents: ['a1', 'a2', 'a3', 'a4'].map((id) => ({
        agentId: id,
        spawnedBy: 't',
        status: EAgentStatus.Finished,
      })) as unknown as RosterWire['agents'],
    })
    expect(groupsOf(entries, data).subagents.collapsed).toBe(0)
  })
})
