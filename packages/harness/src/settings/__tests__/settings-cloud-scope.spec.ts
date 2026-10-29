import { ATLAS_SETTINGS, ESettingId, ESettingsLayer } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { environmentLayer } from '../environment'
import { MemorySettingsStore } from '../memory-store'
import { createSettingsService } from '../service'

const build = (cloudScoped: boolean) =>
  createSettingsService({
    definitions: ATLAS_SETTINGS,
    user: new MemorySettingsStore(),
    project: new MemorySettingsStore({
      document: {
        values: { [ESettingId.GrillingCeremony]: true, [ESettingId.Accent]: 'moss' },
      },
    }),
    environment: environmentLayer({
      definitions: ATLAS_SETTINGS,
      env: { ATLAS_EXPERIMENTAL_GRILLING_CEREMONY: 'on', ATLAS_ACCENT: 'plum' },
    }),
    cloudScoped: () => cloudScoped,
  })

describe('cloud-scoped resolution', () => {
  it('ignores project and environment layers for Cloud settings but honours them for Local ones', () => {
    const settings = build(true).snapshot().resolution.settings
    expect(settings.get(ESettingId.GrillingCeremony)?.layer).toBe(ESettingsLayer.Default)
    expect(settings.get(ESettingId.Accent)?.layer).toBe(ESettingsLayer.Environment)
    expect(settings.get(ESettingId.Accent)?.value).toBe('plum')
  })

  it('keeps every layer when signed out', () => {
    const settings = build(false).snapshot().resolution.settings
    expect(settings.get(ESettingId.GrillingCeremony)?.layer).toBe(ESettingsLayer.Environment)
  })
})
