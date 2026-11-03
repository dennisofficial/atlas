import { describe, expect, it } from 'bun:test'

import {
  ATLAS_SETTINGS,
  catalogOf,
  choiceOptionsOf,
  EEffort,
  EImageTier,
  ESettingId,
  ESettingKind,
  ESettingsLayer,
  findCard,
  resolveSettings,
  type EffortMap,
  type ModelCard,
  type ModelDefinition,
  type SettingsResolution,
} from '@dltech/atlas-core'

import { effortSettingDefinition } from '../compose-effort-setting'
import type { ModelCatalogue } from '../model-catalogue'

const card = (args: { modelId: string; effort?: EffortMap }): ModelCard => ({
  ref: { providerId: 'stub', modelId: args.modelId },
  label: args.modelId,
  api: 'messages',
  contextWindow: 200_000,
  imageTier: EImageTier.HighResolution,
  ...(args.effort === undefined ? {} : { effort: args.effort }),
})

const FOUR_RUNGS: EffortMap = {
  [EEffort.Off]: 0,
  [EEffort.Low]: 'low',
  [EEffort.High]: 'high',
  [EEffort.Max]: 'max',
}

const stubCatalogue = (cards: readonly ModelCard[]): ModelCatalogue => {
  const catalog = catalogOf(cards)
  return {
    providers: [{ id: 'stub', label: 'Stub', cards }],
    catalog,
    cardFor: (ref) => findCard({ catalog, ref }),
    adapterFor: () => undefined,
    reachable: () => true,
    subscribed: () => true,
    observeAccounts: () => {},
    subscribe: () => () => {},
    version: () => 0,
  }
}

const stubModels = stubCatalogue([
  card({ modelId: 'kimi-k3-fast', effort: FOUR_RUNGS }),
  card({ modelId: 'plain' }),
])

const modelIdDefinition = (): ModelDefinition => {
  const held = ATLAS_SETTINGS.find(
    (definition) => definition.id === ESettingId.ModelId && definition.kind === ESettingKind.Model,
  )
  if (held === undefined || held.kind !== ESettingKind.Model) {
    throw new Error('the registry no longer holds a model.id model definition')
  }
  return held
}

const resolutionFor = (modelId: string | undefined): SettingsResolution =>
  resolveSettings({
    definitions: [effortSettingDefinition({ models: stubModels }), modelIdDefinition()],
    layers:
      modelId === undefined
        ? []
        : [
            {
              layer: ESettingsLayer.User,
              origin: 'spec',
              values: { [ESettingId.ModelId]: modelId },
            },
          ],
  })

const offered = (resolution: SettingsResolution): readonly string[] =>
  choiceOptionsOf({
    definition: effortSettingDefinition({ models: stubModels }),
    resolution,
  }).map((option) => option.value)

describe('effortSettingDefinition', () => {
  it('offers only the rungs the resolved default model supports', () => {
    expect(offered(resolutionFor('stub/kimi-k3-fast'))).toEqual(['off', 'low', 'high', 'max'])
  })

  it('offers the full ladder when the model carries no effort map', () => {
    expect(offered(resolutionFor('stub/plain'))).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  })

  it('offers the full ladder when the default model is unset', () => {
    expect(offered(resolutionFor(undefined))).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  })

  it('offers the full ladder when the model is not in the catalogue', () => {
    expect(offered(resolutionFor('stub/gone'))).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  })

  it('keeps the registry facts of the static definition', () => {
    const definition = effortSettingDefinition({ models: stubCatalogue([]) })
    expect(definition.id).toBe(ESettingId.ModelEffort)
    expect(definition.environmentVariable).toBe('ATLAS_EFFORT')
    expect(definition.fallback).toBe(EEffort.Medium)
    expect(definition.options).toHaveLength(7)
  })
})
