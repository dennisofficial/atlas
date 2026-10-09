import { describe, expect, it } from 'bun:test'

import { isSettingVisible, type SettingDefinition } from '../definition'
import { ESettingsLayer } from '../layers'
import { ATLAS_SETTINGS, ESettingId } from '../registry'
import { resolveSettings } from '../resolve'
import { toggle } from './fixture'

const resolutionOf = (values: Record<string, unknown> = {}) =>
  resolveSettings({
    definitions: ATLAS_SETTINGS,
    layers: [{ layer: ESettingsLayer.User, origin: 'user', values }],
  })

const definitionOf = (id: ESettingId): SettingDefinition => {
  const found = ATLAS_SETTINGS.find((definition) => definition.id === id)
  if (found === undefined) throw new Error(`no definition ${id}`)
  return found
}

describe('isSettingVisible', () => {
  it('is visible when the definition carries no predicate', () => {
    expect(isSettingVisible({ definition: toggle, resolution: resolutionOf() })).toBe(true)
  })

  it('hands the resolution to the predicate and respects its answer', () => {
    const seen: unknown[] = []
    const hidden: SettingDefinition = {
      ...toggle,
      visibleWhen: ({ resolution }) => {
        seen.push(resolution)
        return false
      },
    }
    const resolution = resolutionOf()

    expect(isSettingVisible({ definition: hidden, resolution })).toBe(false)
    expect(seen).toEqual([resolution])
    expect(isSettingVisible({ definition: { ...toggle, visibleWhen: () => true }, resolution })).toBe(true)
  })
})

describe('the decisions rows', () => {
  const visibleOn = (provider?: string) =>
    [ESettingId.DecisionsProvider, ESettingId.DecisionsUrl, ESettingId.DecisionsModel, ESettingId.DecisionsToken].filter(
      (id) =>
        isSettingVisible({
          definition: definitionOf(id),
          resolution: resolutionOf(provider === undefined ? {} : { [ESettingId.DecisionsProvider]: provider }),
        }),
    )

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
