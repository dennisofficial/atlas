import { describe, expect, it } from 'bun:test'

import { EAgentDisplay } from '../agent-status'
import { EDetailRow, detailRows, hasOutcome, toolCallsLabel } from '../agents-panel-detail-rows'
import { isNearBottom, nextStuck } from '../agents-panel-scroll'
import type { AgentsPanelAgent } from '../agents-panel-types'
import { generateToolCalls } from '../agents-panel.fixtures'

const agent = (overrides: Partial<AgentsPanelAgent> = {}): AgentsPanelAgent => ({
  id: 'a',
  agentType: 'explore',
  intent: 'map',
  display: EAgentDisplay.Running,
  elapsed: '1s',
  model: 'm',
  brief: 'brief',
  calls: generateToolCalls({ count: 400, running: true }),
  ...overrides,
})

describe('detailRows', () => {
  it('lays out brief, label, every call, then nothing while running', () => {
    const rows = detailRows({ agent: agent() })

    expect(rows).toHaveLength(402)
    expect(rows[0]?.kind).toBe(EDetailRow.Brief)
    expect(rows[1]).toMatchObject({ kind: EDetailRow.CallsLabel, count: 400 })
    expect(rows.at(-1)?.kind).toBe(EDetailRow.Call)
  })

  it('appends the report row for a done agent with a report', () => {
    const rows = detailRows({ agent: agent({ display: EAgentDisplay.Done, report: 'ok' }) })

    expect(rows.at(-1)?.kind).toBe(EDetailRow.Outcome)
  })

  it('appends the error row for a failed agent with error text', () => {
    expect(hasOutcome(agent({ display: EAgentDisplay.Failed, errorText: 'boom' }))).toBe(true)
    expect(hasOutcome(agent({ display: EAgentDisplay.Failed }))).toBe(false)
  })

  it('omits the calls section when there are no calls', () => {
    const rows = detailRows({ agent: agent({ calls: [] }) })

    expect(rows.map((row) => row.kind)).toEqual([EDetailRow.Brief])
  })

  it('gives every row a unique key', () => {
    const keys = detailRows({ agent: agent() }).map((row) => row.key)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('puts the total in the section label', () => {
    expect(toolCallsLabel(312)).toBe('Tool calls · 312')
  })
})

describe('stick to bottom', () => {
  const metrics = { clientHeight: 400, scrollHeight: 10_000 }

  it('is near the bottom within the threshold', () => {
    expect(isNearBottom({ ...metrics, scrollTop: 9_600 })).toBe(true)
    expect(isNearBottom({ ...metrics, scrollTop: 9_000 })).toBe(false)
  })

  it('unsticks when the user scrolls up', () => {
    expect(nextStuck({ ...metrics, scrollTop: 5_000, previousTop: 6_000, stuck: true })).toBe(false)
  })

  it('stays stuck when content grows without the user scrolling up', () => {
    expect(nextStuck({ ...metrics, scrollTop: 5_000, previousTop: 5_000, stuck: true })).toBe(true)
  })

  it('re-sticks on returning to the bottom', () => {
    expect(nextStuck({ ...metrics, scrollTop: 9_600, previousTop: 9_000, stuck: false })).toBe(true)
  })
})
