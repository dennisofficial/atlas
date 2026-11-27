import { describe, expect, it } from 'bun:test'

import { EImageModel } from '../agent-settings'
import { agentSettingsChanges, agentSettingsFrom } from '../agent-settings'

describe('agent settings mapper', () => {
  it('reads the image fallback when nothing is stored', () => {
    expect(agentSettingsFrom(new Map())).toEqual({
      imageModel: EImageModel.Gemini31FlashImage,
    })
  })

  it('writes the chosen image model', () => {
    const saved = agentSettingsFrom(new Map())
    const draft = { ...saved, imageModel: EImageModel.MaiImage27 }
    expect(agentSettingsChanges({ saved, draft })).toEqual({
      'images.model': 'microsoft/mai-image-2.7',
    })
  })

  it('emits no changes when the draft matches the stored value', () => {
    const saved = agentSettingsFrom(new Map([['images.model', 'spacexai/grok-imagine-image-2.0']]))
    expect(agentSettingsChanges({ saved, draft: saved })).toEqual({})
  })

  it('falls back when a stored value is outside the enum', () => {
    const settings = agentSettingsFrom(new Map([['images.model', 'bfl/flux-kontext-pro']]))
    expect(settings.imageModel).toBe(EImageModel.Gemini31FlashImage)
  })
})
