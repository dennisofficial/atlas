import { describe, expect, it } from 'bun:test'

import { ESearchBackend } from '../../../fixtures/settings-search'
import { agentSettingsChanges, agentSettingsFrom } from '../agent-settings'

describe('agent settings mapper', () => {
  it('reads the search fallback when nothing is stored', () => {
    expect(agentSettingsFrom(new Map())).toEqual({ searchBackend: ESearchBackend.Bing })
  })

  it('writes the chosen search backend', () => {
    const saved = agentSettingsFrom(new Map())
    const draft = { searchBackend: ESearchBackend.Exa }
    expect(agentSettingsChanges({ saved, draft })).toEqual({ 'web.searchBackend': 'exa' })
  })

  it('emits no changes when the draft matches the stored value', () => {
    const saved = agentSettingsFrom(new Map([['web.searchBackend', 'exa']]))
    expect(agentSettingsChanges({ saved, draft: saved })).toEqual({})
  })

  it('falls back when a stored value is outside the enum', () => {
    const settings = agentSettingsFrom(new Map([['web.searchBackend', 'google']]))
    expect(settings.searchBackend).toBe(ESearchBackend.Bing)
  })
})
