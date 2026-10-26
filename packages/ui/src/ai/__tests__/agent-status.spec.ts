import { describe, expect, it } from 'bun:test'

import { EAgentDisplay, agentDisplayLabel, needsAttention } from '../agent-status'

describe('agent status', () => {
  it('labels every display', () => {
    expect(Object.values(EAgentDisplay).map((display) => agentDisplayLabel(display))).toEqual([
      'Starting sandbox',
      'Running',
      'Needs approval',
      'Paused',
      'Failed',
      'Done',
    ])
  })

  it('flags only needs-approval and failed for attention', () => {
    const flagged = Object.values(EAgentDisplay).filter((display) => needsAttention(display))

    expect(flagged).toEqual([EAgentDisplay.NeedsApproval, EAgentDisplay.Failed])
  })

  it('uses kebab-case string values', () => {
    expect(Object.values(EAgentDisplay).map(String)).toEqual([
      'starting-sandbox',
      'running',
      'needs-approval',
      'paused',
      'failed',
      'done',
    ])
  })
})
