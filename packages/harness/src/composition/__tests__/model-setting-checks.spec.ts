import { describe, expect, it } from 'bun:test'

import {
  agentTypeModelDefinitions,
  ATLAS_SETTINGS,
  ESettingId,
  type SettingDefinition,
} from '@dltech/atlas-core'

import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { unreachableModelSettings } from '../model-setting-checks'
import { fakeCatalogue } from './fakes'

const resolutionOver = (values: Record<string, string>) =>
  createSettingsService({
    definitions: ATLAS_SETTINGS,
    user: new MemorySettingsStore({ document: { values } }),
  }).snapshot().resolution

describe('unreachableModelSettings', () => {
  it('finds nothing when every model row is empty', () => {
    expect(
      unreachableModelSettings({
        definitions: ATLAS_SETTINGS,
        resolution: resolutionOver({}),
        catalogue: fakeCatalogue(),
      }),
    ).toEqual([])
  })

  it('finds nothing for a reachable pick', () => {
    expect(
      unreachableModelSettings({
        definitions: ATLAS_SETTINGS,
        resolution: resolutionOver({ [ESettingId.QuickModel]: 'anthropic/claude-sonnet-5' }),
        catalogue: fakeCatalogue(),
      }),
    ).toEqual([])
  })

  it('flags a provider with no account', () => {
    const problems = unreachableModelSettings({
      definitions: ATLAS_SETTINGS,
      resolution: resolutionOver({ [ESettingId.QuickModel]: 'openai/gpt-5-codex' }),
      catalogue: fakeCatalogue(),
    })

    expect(problems).toEqual([
      {
        id: ESettingId.QuickModel,
        label: 'Quick calls',
        reference: 'openai/gpt-5-codex',
        reason: 'provider-not-set-up',
      },
    ])
  })

  it('flags a model no provider carries', () => {
    const problems = unreachableModelSettings({
      definitions: ATLAS_SETTINGS,
      resolution: resolutionOver({ [ESettingId.ModelId]: 'anthropic/claude-nine' }),
      catalogue: fakeCatalogue(),
    })

    expect(problems[0]?.reason).toBe('unknown-model')
    expect(problems[0]?.id).toBe(ESettingId.ModelId)
  })

  it('checks late-registered per-type rows too', () => {
    const definitions: readonly SettingDefinition[] = [
      ...ATLAS_SETTINGS,
      ...agentTypeModelDefinitions({ typeNames: ['explore'] }),
    ]

    const problems = unreachableModelSettings({
      definitions,
      resolution: createSettingsService({
        definitions,
        user: new MemorySettingsStore({
          document: { values: { 'agents.type.explore': 'openai/gpt-5-codex' } },
        }),
      }).snapshot().resolution,
      catalogue: fakeCatalogue(),
    })

    expect(problems.map((problem) => problem.id)).toEqual(['agents.type.explore'])
  })
})
