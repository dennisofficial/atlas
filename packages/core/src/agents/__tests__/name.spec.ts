import { describe, expect, it } from 'bun:test'

import { agentDisplayName } from '../name'

describe('agentDisplayName', () => {
  it('keeps an intent already short enough to be a name', () => {
    expect(agentDisplayName({ agentType: 'explore', intent: 'Audit settings registry' })).toBe(
      'Audit settings registry',
    )
  })

  it('cuts a long intent to its first three words, without an ellipsis', () => {
    expect(
      agentDisplayName({ agentType: 'builder', intent: 'Trace failed descend and retry path' }),
    ).toBe('Trace failed descend')
  })

  it('falls back to the agent type when the intent is blank', () => {
    expect(agentDisplayName({ agentType: 'explore', intent: '   ' })).toBe('explore')
  })

  it('collapses a multi-line intent before taking words', () => {
    expect(agentDisplayName({ agentType: 'review', intent: 'read this\n\nthen that' })).toBe(
      'read this then',
    )
  })
})
