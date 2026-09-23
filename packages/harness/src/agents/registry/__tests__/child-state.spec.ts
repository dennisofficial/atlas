import { describe, expect, it } from 'bun:test'

import { EAgentStatus, toThreadId, type RosteredAgent } from '@dltech/atlas-core'

import {
  agentEndedDraft,
  freshChild,
  LAST_TEXT_TAIL_CHARACTERS,
  recordProgress,
  recoveredChild,
} from '../child-state'
import { said } from './fixtures'

const child = () =>
  freshChild({
    agentId: toThreadId('thread-child'),
    spawnedBy: toThreadId('thread-parent'),
    agentType: 'explore',
    intent: 'looking',
    at: '2026-01-01T00:00:00.000Z',
    projectDirectory: undefined,
  })

const beyondCap = (): string => {
  const head = 'x'.repeat(LAST_TEXT_TAIL_CHARACTERS)
  const tail = 'y'.repeat(LAST_TEXT_TAIL_CHARACTERS)
  return head + tail
}

describe('recordProgress lastText', () => {
  it('keeps a short final text whole', () => {
    const state = child()
    recordProgress({ child: state, drafts: said('all done') })

    expect(state.lastText).toBe('all done')
  })

  it('keeps only the tail of a text past the cap', () => {
    const state = child()
    const text = beyondCap()
    recordProgress({ child: state, drafts: said(text) })

    expect(state.lastText).toHaveLength(LAST_TEXT_TAIL_CHARACTERS)
    expect(state.lastText).toBe(text.slice(-LAST_TEXT_TAIL_CHARACTERS))
  })

  it('stays bounded across many steps', () => {
    const state = child()
    for (let step = 0; step < 20; step += 1) {
      recordProgress({ child: state, drafts: said(beyondCap()) })
    }

    expect(state.lastText).toHaveLength(LAST_TEXT_TAIL_CHARACTERS)
  })
})

describe('agentEndedDraft prose', () => {
  it('carries the whole final text, however far past the roster cap it runs', () => {
    const state = child()
    const text = beyondCap()
    recordProgress({ child: state, drafts: said(text) })

    const draft = agentEndedDraft(state)
    expect(draft.type).toBe('agent-ended')
    expect(draft.type === 'agent-ended' ? draft.prose : '').toBe(text)
  })

  it('still tails the roster text the draft leaves behind', () => {
    const state = child()
    recordProgress({ child: state, drafts: said(beyondCap()) })

    agentEndedDraft(state)
    expect(state.lastText).toHaveLength(LAST_TEXT_TAIL_CHARACTERS)
  })
})

describe('recoveredChild lastText', () => {
  it('bounds prose recovered from an old unbounded ending', () => {
    const agent: RosteredAgent = {
      agentId: toThreadId('thread-child'),
      agentType: 'explore',
      intent: 'looking',
      status: EAgentStatus.Finished,
      turns: 3,
      toolCalls: 5,
      prose: beyondCap(),
      killedBy: undefined,
      spawnedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:01:00.000Z',
    }

    const state = recoveredChild({
      agent,
      spawnedBy: toThreadId('thread-parent'),
      at: '2026-01-01T00:02:00.000Z',
    })

    expect(state.lastText).toHaveLength(LAST_TEXT_TAIL_CHARACTERS)
    expect(state.lastText).toBe(agent.prose.slice(-LAST_TEXT_TAIL_CHARACTERS))
  })

  it('keeps the recovered prose whole for the ending', () => {
    const agent: RosteredAgent = {
      agentId: toThreadId('thread-child'),
      agentType: 'explore',
      intent: 'looking',
      status: EAgentStatus.Finished,
      turns: 3,
      toolCalls: 5,
      prose: beyondCap(),
      killedBy: undefined,
      spawnedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:01:00.000Z',
    }

    const state = recoveredChild({
      agent,
      spawnedBy: toThreadId('thread-parent'),
      at: '2026-01-01T00:02:00.000Z',
    })

    const draft = agentEndedDraft(state)
    expect(draft.type === 'agent-ended' ? draft.prose : '').toBe(agent.prose)
  })
})
