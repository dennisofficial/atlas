import { describe, expect, it } from 'bun:test'

import { EImageModel } from '../../../fixtures/settings-images'
import { ESearchBackend } from '../../../fixtures/settings-search'
import { agentSettingsChanges, agentSettingsFrom } from '../agent-settings'

describe('agent settings mapper', () => {
  it('reads the search and image fallbacks when nothing is stored', () => {
    expect(agentSettingsFrom(new Map())).toEqual({
      searchBackend: ESearchBackend.Bing,
      imageModel: EImageModel.Gemini31FlashImage,
    })
  })

  it('writes the chosen search backend', () => {
    const saved = agentSettingsFrom(new Map())
    const draft = { ...saved, searchBackend: ESearchBackend.Exa }
    expect(agentSettingsChanges({ saved, draft })).toEqual({ 'web.searchBackend': 'exa' })
  })

  it('writes the chosen image model', () => {
    const saved = agentSettingsFrom(new Map())
    const draft = { ...saved, imageModel: EImageModel.MaiImage27 }
    expect(agentSettingsChanges({ saved, draft })).toEqual({
      'images.model': 'microsoft/mai-image-2.7',
    })
  })

  it('emits no changes when the draft matches the stored value', () => {
    const saved = agentSettingsFrom(
      new Map([
        ['web.searchBackend', 'exa'],
        ['images.model', 'spacexai/grok-imagine-image-2.0'],
      ]),
    )
    expect(agentSettingsChanges({ saved, draft: saved })).toEqual({})
  })

  it('falls back when a stored value is outside the enum', () => {
    const settings = agentSettingsFrom(
      new Map([
        ['web.searchBackend', 'google'],
        ['images.model', 'bfl/flux-kontext-pro'],
      ]),
    )
    expect(settings.searchBackend).toBe(ESearchBackend.Bing)
    expect(settings.imageModel).toBe(EImageModel.Gemini31FlashImage)
  })
})
