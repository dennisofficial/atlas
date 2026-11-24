import { describe, expect, it } from 'bun:test'

import { isSettingVisible, type SettingDefinition } from '../definition'
import { ESettingsLayer } from '../layers'
import { ATLAS_SETTINGS } from '../registry'
import { resolveSettings } from '../resolve'
import { toggle } from './fixture'

const resolutionOf = (values: Record<string, unknown> = {}) =>
  resolveSettings({
    definitions: ATLAS_SETTINGS,
    layers: [{ layer: ESettingsLayer.User, origin: 'user', values }],
  })

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
    expect(
      isSettingVisible({ definition: { ...toggle, visibleWhen: () => true }, resolution }),
    ).toBe(true)
  })
})
