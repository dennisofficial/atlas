import { describe, expect, it, mock } from 'bun:test'

import { EMPTY_DETAILS } from '@/features/threads/panel/details/details-input'

import { panelValueOf } from '../panel-value'

describe('panelValueOf', () => {
  it('hands the agent selection and its handlers to the transcript', () => {
    const opened: string[] = []
    let cleared = 0
    const panel = panelValueOf({
      sessionId: 'ses-1',
      working: true,
      agentId: 'agent-1',
      parentAgentId: 'agent-0',
      openAgent: (agentId) => opened.push(agentId),
      clearAgent: () => {
        cleared += 1
      },
    })

    expect(panel.threadId).toBe('ses-1')
    expect(panel.working).toBe(true)
    expect(panel.agentId).toBe('agent-1')
    expect(panel.agentParentId).toBe('agent-0')
    panel.openAgent('agent-2')
    panel.clearAgent()
    expect(opened).toEqual(['agent-2'])
    expect(cleared).toBe(1)
    expect(panel.details).toBe(EMPTY_DETAILS)
  })

  it('keeps the panel actions that the transcript pixels at as no-ops', () => {
    const panel = panelValueOf({
      sessionId: 'ses-1',
      working: false,
      agentId: undefined,
      openAgent: mock(() => undefined),
      clearAgent: mock(() => undefined),
    })
    expect(panel.agentId).toBeUndefined()
    expect(panel.agentParentId).toBeUndefined()
    expect(panel.openChanges()).toBeUndefined()
    expect(panel.closePanel()).toBeUndefined()
  })
})
