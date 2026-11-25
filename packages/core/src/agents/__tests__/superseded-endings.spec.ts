import { describe, expect, it } from 'bun:test'

import { log } from '../../assembly/__tests__/log-fixture'
import type { EventDraft } from '../../events/body'
import { toThreadId } from '../../events/ids'
import { EKilledBy } from '../../shells/status'
import { EAgentStatus } from '../status'
import { supersededEndingIds } from '../superseded-endings'

const ended = (
  agentId: string,
  over: Partial<Extract<EventDraft, { type: 'agent-ended' }>> = {},
): EventDraft => ({
  type: 'agent-ended',
  agentId: toThreadId(agentId),
  agentType: 'builder',
  intent: agentId,
  status: EAgentStatus.Stopped,
  killedBy: EKilledBy.SessionEnd,
  prose: '',
  turns: 1,
  toolCalls: 1,
  ...over,
})

const said: EventDraft = { type: 'assistant-said', parts: [{ type: 'text', text: 'noted' }] }

describe('supersededEndingIds', () => {
  it('keeps only the newest ending of an agent that ended many times between two model steps', () => {
    const events = log([ended('a'), ended('b'), ended('a'), ended('b'), ended('a')])

    expect([...supersededEndingIds(events)]).toEqual(['event-1', 'event-2', 'event-3'])
  })

  it('keeps an ending the model already answered', () => {
    const events = log([ended('a'), said, ended('a', { status: EAgentStatus.Finished })])

    expect(supersededEndingIds(events).size).toBe(0)
  })

  it('lets a later clean ending supersede a session-end stop', () => {
    const events = log([
      ended('a'),
      ended('a', { status: EAgentStatus.Finished, killedBy: undefined }),
    ])

    expect([...supersededEndingIds(events)]).toEqual(['event-1'])
  })

  it('keeps a finished ending even when the same agent ends again before the model steps', () => {
    const events = log([
      ended('a', { status: EAgentStatus.Finished, killedBy: undefined }),
      ended('a'),
    ])

    expect(supersededEndingIds(events).size).toBe(0)
  })

  it('ignores a bookkeeping ending that never reaches the model', () => {
    const events = log([ended('a'), ended('a', { relayed: false })])

    expect(supersededEndingIds(events).size).toBe(0)
  })
})
