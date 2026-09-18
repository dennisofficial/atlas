import { describe, expect, it } from 'bun:test'

import { agentTypeSettingId, ATLAS_SETTINGS, ESettingId, refKey } from '@dltech/atlas-core'

import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { suggestedModelRef } from '../model-suggestions'
import { fakeCatalogue } from './fakes'

const settledOver = (values: Record<string, string>) =>
  createSettingsService({
    definitions: ATLAS_SETTINGS,
    user: new MemorySettingsStore({ document: { values } }),
  }).snapshot().resolution

describe('suggestedModelRef', () => {
  it('suggests the cheapest reachable card for the quick tier', () => {
    const ref = suggestedModelRef({
      id: ESettingId.QuickModel,
      settled: settledOver({}),
      catalogue: fakeCatalogue(),
    })

    expect(refKey(ref)).toBe('anthropic/claude-haiku-4-5')
  })

  it('suggests the default model for compaction and the sub-agent role', () => {
    const settled = settledOver({ [ESettingId.ModelId]: 'anthropic/claude-opus-5' })

    for (const id of [ESettingId.CompactionModel, ESettingId.SubagentModel]) {
      expect(refKey(suggestedModelRef({ id, settled, catalogue: fakeCatalogue() }))).toBe(
        'anthropic/claude-opus-5',
      )
    }
  })

  it('suggests the sub-agent role for a per-type row when one is set', () => {
    const settled = settledOver({
      [ESettingId.ModelId]: 'anthropic/claude-opus-5',
      [ESettingId.SubagentModel]: 'anthropic/claude-sonnet-5',
    })

    expect(
      refKey(
        suggestedModelRef({
          id: agentTypeSettingId('explore'),
          settled,
          catalogue: fakeCatalogue(),
        }),
      ),
    ).toBe('anthropic/claude-sonnet-5')
  })

  it('skips a sub-agent role whose provider is not set up, falling to the default', () => {
    const settled = settledOver({
      [ESettingId.ModelId]: 'anthropic/claude-opus-5',
      [ESettingId.SubagentModel]: 'openai/gpt-5-codex',
    })

    expect(
      refKey(
        suggestedModelRef({
          id: agentTypeSettingId('builder'),
          settled,
          catalogue: fakeCatalogue(),
        }),
      ),
    ).toBe('anthropic/claude-opus-5')
  })

  it('suggests the first reachable provider when the shipped default has no account', () => {
    const base = fakeCatalogue()
    const openaiOnly = { ...base, reachable: (providerId: string) => providerId === 'openai' }

    expect(
      refKey(suggestedModelRef({ id: ESettingId.ModelId, settled: settledOver({}), catalogue: openaiOnly })),
    ).toBe('openai/gpt-5-codex')
  })
})
