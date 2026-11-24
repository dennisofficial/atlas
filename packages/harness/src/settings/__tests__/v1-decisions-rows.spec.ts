import {
  ATLAS_SETTINGS,
  ESettingId,
  ESettingsLayer,
  isSettingVisible,
  resolveSettings,
  type SettingDefinition,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { V1_ONLY_SETTING_DEFINITIONS } from '../v1-only-definitions'

const DEFINITIONS: readonly SettingDefinition[] = [
  ...ATLAS_SETTINGS,
  ...V1_ONLY_SETTING_DEFINITIONS,
]

const resolutionOf = (values: Record<string, unknown> = {}) =>
  resolveSettings({
    definitions: DEFINITIONS,
    layers: [{ layer: ESettingsLayer.User, origin: 'user', values }],
  })

const definitionOf = (id: ESettingId): SettingDefinition => {
  const found = DEFINITIONS.find((definition) => definition.id === id)
  if (found === undefined) throw new Error(`no definition ${id}`)
  return found
}

const visibleOn = (provider?: string) =>
  [
    ESettingId.DecisionsProvider,
    ESettingId.DecisionsUrl,
    ESettingId.DecisionsModel,
    ESettingId.DecisionsToken,
  ].filter((id) =>
    isSettingVisible({
      definition: definitionOf(id),
      resolution: resolutionOf(
        provider === undefined ? {} : { [ESettingId.DecisionsProvider]: provider },
      ),
    }),
  )

describe('the v1 decisions rows', () => {
  it('shows only the provider and key on a preset', () => {
    for (const provider of [undefined, 'typesafe', 'vercel', 'openai']) {
      expect(visibleOn(provider)).toEqual([ESettingId.DecisionsProvider, ESettingId.DecisionsToken])
    }
  })

  it('shows the endpoint and model on custom', () => {
    expect(visibleOn('custom')).toEqual([
      ESettingId.DecisionsProvider,
      ESettingId.DecisionsUrl,
      ESettingId.DecisionsModel,
      ESettingId.DecisionsToken,
    ])
  })
})
