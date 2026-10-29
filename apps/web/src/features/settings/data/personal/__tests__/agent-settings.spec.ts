import { describe, expect, it } from 'bun:test'

import {
  EClassifierMode,
  EDecisionsProvider,
  ESearchBackend,
  type AgentSettings,
} from '../../../fixtures/settings-decisions'
import { agentSettingsChanges, agentSettingsFrom, isValidDecisionsUrl } from '../agent-settings'

const CUSTOM_DRAFT: AgentSettings = {
  provider: EDecisionsProvider.Custom,
  url: 'https://jev.internal',
  model: 'jev-luna',
  classifierMode: EClassifierMode.Nudge,
  searchBackend: ESearchBackend.Exa,
}

describe('agent settings mapper', () => {
  it('reads fallbacks when nothing is stored', () => {
    expect(agentSettingsFrom(new Map())).toEqual({
      provider: EDecisionsProvider.Typesafe,
      url: '',
      model: 'jev-latest',
      classifierMode: EClassifierMode.Shadow,
      searchBackend: ESearchBackend.DuckDuckGo,
    })
  })

  it('round-trips a custom endpoint and classifier/search choices into changes', () => {
    const saved = agentSettingsFrom(new Map())
    expect(agentSettingsChanges({ saved, draft: CUSTOM_DRAFT })).toEqual({
      'decisions.provider': 'custom',
      'decisions.url': 'https://jev.internal',
      'decisions.model': 'jev-luna',
      'classifier.mode': 'nudge',
      'web.searchBackend': 'exa',
    })
  })

  it('emits no changes when the draft matches the stored values', () => {
    const saved = agentSettingsFrom(
      new Map([
        ['decisions.provider', 'custom'],
        ['decisions.url', 'https://jev.internal'],
        ['decisions.model', 'jev-luna'],
        ['classifier.mode', 'nudge'],
        ['web.searchBackend', 'exa'],
      ]),
    )
    expect(saved).toEqual(CUSTOM_DRAFT)
    expect(agentSettingsChanges({ saved, draft: CUSTOM_DRAFT })).toEqual({})
  })

  it('falls back when a stored value is outside the enum', () => {
    const settings = agentSettingsFrom(
      new Map([
        ['classifier.mode', 'interrupt'],
        ['web.searchBackend', 'google'],
      ]),
    )
    expect(settings.classifierMode).toBe(EClassifierMode.Shadow)
    expect(settings.searchBackend).toBe(ESearchBackend.DuckDuckGo)
  })

  it('rejects a non-URL decisions endpoint', () => {
    expect(isValidDecisionsUrl('jev.internal')).toBe(false)
    expect(isValidDecisionsUrl('')).toBe(true)
    expect(isValidDecisionsUrl('https://jev.internal/v1/systemone')).toBe(true)
  })
})
