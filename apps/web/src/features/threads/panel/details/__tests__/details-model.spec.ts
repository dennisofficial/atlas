import { describe, expect, it } from 'bun:test'

import { EPlanStatus } from '@dltech/atlas-core'
import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'

import {
  crewGroupsOf,
  crewMembersOf,
  earlierLabelOf,
  planCountOf,
  planDoneLabelOf,
  settledLabelOf,
  tokenFiguresOf,
  turnsLabelOf,
  type CrewRow,
} from '../details-model'

const row = (id: string, display: EAgentDisplay, teammate = false): CrewRow => ({
  id,
  title: id,
  subtitle: undefined,
  display,
  teammate,
})

describe('details model', () => {
  it('labels turns and plan counts', () => {
    expect(turnsLabelOf(1)).toBe('1 turn')
    expect(turnsLabelOf(3)).toBe('3 turns')
    expect(planCountOf([{ status: EPlanStatus.Completed }, { status: EPlanStatus.Pending }])).toBe(
      '1/2',
    )
    expect(planDoneLabelOf({ hidden: 3, expanded: false })).toBe('3 earlier done')
    expect(earlierLabelOf({ hidden: 2, failed: true })).toBe('+2 earlier · one failed')
  })

  it('shows uncached input, output and cache only when read', () => {
    const base = {
      inputTokens: 1500,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      uncachedInputTokens: 1500,
      costUsd: null,
    }
    expect(tokenFiguresOf(base)).toBe('↑ 1.5k  ↓ 200')
    expect(
      tokenFiguresOf({
        ...base,
        cacheReadTokens: 500,
        uncachedInputTokens: 1000,
      }),
    ).toBe('↑ 1.0k  ↓ 200  cache 500')
  })

  it('folds settled sub-agents behind a count and counts working', () => {
    const rows = [
      row('a', EAgentDisplay.Done),
      row('b', EAgentDisplay.Done),
      row('c', EAgentDisplay.Done),
      row('d', EAgentDisplay.Done),
      row('e', EAgentDisplay.Running),
      row('m', EAgentDisplay.Running, true),
    ]
    const members = crewMembersOf({ rows, snapshots: [], threadId: 't' })
    const { subagents, teammates } = crewGroupsOf({
      rows,
      members,
      viewing: null,
      expanded: { subagents: false, teammates: false },
    })
    expect(subagents.total).toBe(5)
    expect(subagents.working).toBe(1)
    expect(subagents.collapsed).toBe(2)
    expect(subagents.rows.map((r) => r.id)).toEqual(['c', 'd', 'e'])
    expect(teammates.total).toBe(1)
    expect(subagents.collapsedFailed).toBe(false)
    expect(settledLabelOf({ collapsed: 2, expanded: false, failed: true })).toBe(
      '2 settled · one failed',
    )
  })
})
