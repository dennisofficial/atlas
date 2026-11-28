import { expect, it } from 'bun:test'

import { EAgentStatus } from '@dltech/atlas-core'
import { sessionViewOutputSchema } from '@dltech/atlas-protocol'

import realSession from '../../panel/details-card.fixture.json'
import { sessionViewModelOf } from '../session-view-model'

it('orders the session crew through the shared plugin ordering', () => {
  const row = {
    agentType: 'explore',
    intent: 'Read the tree',
    turns: 0,
    toolCalls: 0,
    startedAt: '2026-11-28T10:00:00.000Z',
  }
  const view = sessionViewOutputSchema.parse({
    ...realSession,
    pluginViews: {
      crew: [
        { ...row, agentId: 'ended', status: EAgentStatus.Finished },
        { ...row, agentId: 'blocked', status: EAgentStatus.Blocked },
        { ...row, agentId: 'running', status: EAgentStatus.Running },
      ],
    },
  })
  const model = sessionViewModelOf(view)
  expect(model.crewRows.map((row) => row.agentId)).toEqual(['running', 'blocked', 'ended'])
  expect(model.crew).toEqual({ running: 1, total: 3 })
})
