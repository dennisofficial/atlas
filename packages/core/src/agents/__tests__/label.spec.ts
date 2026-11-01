import { describe, expect, it } from 'bun:test'

import { agentLabel, childThreadTitle, displayedThreadTitle } from '../label'

describe('titling a child thread', () => {
  it('titles a teammate session with its intent alone', () => {
    expect(childThreadTitle({ agentType: 'teammate', intent: 'Durable send\n intake' })).toBe(
      'Durable send intake',
    )
  })

  it('keeps the type label for a sub-agent', () => {
    expect(childThreadTitle({ agentType: 'explore', intent: 'find callers' })).toBe(
      'explore "find callers"',
    )
  })

  it('falls back to the type when a teammate has no intent', () => {
    expect(childThreadTitle({ agentType: 'teammate', intent: '  ' })).toBe('teammate')
  })
})

describe('displaying a stored thread title', () => {
  it('strips the legacy teammate prefix and quotes', () => {
    expect(displayedThreadTitle('teammate "Branch label follows"')).toBe('Branch label follows')
  })

  it('leaves other titles untouched', () => {
    expect(displayedThreadTitle('explore "find callers"')).toBe('explore "find callers"')
    expect(displayedThreadTitle('Fix the sidebar')).toBe('Fix the sidebar')
  })
})

describe('naming a delegate for the parent that spawned it', () => {
  it('pairs the agent type with the intent it was given', () => {
    expect(agentLabel({ agentType: 'explore', intent: 'audit the settings registry' })).toBe(
      'explore "audit the settings registry"',
    )
  })

  it('falls back to the type alone when there is no intent to quote', () => {
    expect(agentLabel({ agentType: 'explore', intent: '   ' })).toBe('explore')
  })

  it('collapses a multi-line intent onto one line', () => {
    expect(agentLabel({ agentType: 'review', intent: 'read this\n\nthen that' })).toBe(
      'review "read this then that"',
    )
  })

  it('truncates an intent long enough to crowd out the report it heads', () => {
    const label = agentLabel({ agentType: 'review', intent: 'x'.repeat(400) })

    expect(label.length).toBeLessThan(140)
    expect(label).toContain('…')
  })
})
