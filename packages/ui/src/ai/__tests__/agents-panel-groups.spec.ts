import { describe, expect, it } from 'bun:test'

import { EAgentDisplay } from '../agent-status'
import {
  doneAgents,
  hiddenDoneCount,
  runningAgentCount,
  runningAgents,
  showMoreLabel,
  visibleDone,
} from '../agents-panel-groups'
import type { AgentsPanelAgent } from '../agents-panel-types'

const agent = (id: string, display: EAgentDisplay, endedAt?: number): AgentsPanelAgent => ({
  id,
  agentType: 'explore',
  intent: id,
  display,
  elapsed: '1s',
  model: 'm',
  endedAt,
  brief: '',
  calls: [],
})

const MIXED = [
  agent('run', EAgentDisplay.Running),
  agent('boot', EAgentDisplay.StartingSandbox),
  agent('ask', EAgentDisplay.NeedsApproval),
  agent('pause', EAgentDisplay.Paused),
  agent('old', EAgentDisplay.Done, 1),
  agent('bad', EAgentDisplay.Failed, 3),
  agent('new', EAgentDisplay.Done, 2),
]

describe('agents panel groups', () => {
  it('puts running, booting, approval and paused agents in Running', () => {
    expect(runningAgents(MIXED).map((entry) => entry.id)).toEqual(['run', 'boot', 'ask', 'pause'])
    expect(runningAgentCount(MIXED)).toBe(4)
  })

  it('orders Done newest first, failed included', () => {
    expect(doneAgents(MIXED).map((entry) => entry.id)).toEqual(['bad', 'new', 'old'])
  })

  it('shows the first five done agents and counts the rest', () => {
    const done = Array.from({ length: 8 }, (_, index) =>
      agent(`d${index}`, EAgentDisplay.Done, index),
    )

    expect(visibleDone({ done, expanded: false })).toHaveLength(5)
    expect(visibleDone({ done, expanded: true })).toHaveLength(8)
    expect(hiddenDoneCount(done)).toBe(3)
    expect(showMoreLabel(3)).toBe('Show 3 more')
  })

  it('hides nothing when five or fewer are done', () => {
    expect(hiddenDoneCount(doneAgents(MIXED))).toBe(0)
  })
})
