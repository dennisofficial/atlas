import { describe, expect, it } from 'bun:test'

import {
  ATLAS_SETTINGS,
  ESettingId,
  ESettingsLayer,
  resolveSettings,
  type SettingsLayerInput,
} from '@dltech/atlas-core'
import { CLOUD_SETTING_DEFINITIONS, isCloudSettingId } from '@dltech/atlas-harness'

import { cloudUrlOf } from '../live-cloud'

const definitions = [
  ...ATLAS_SETTINGS.filter((definition) => !isCloudSettingId(definition.id)),
  ...CLOUD_SETTING_DEFINITIONS,
]

const appWith = (args: { sessionUrl: string | null; configured?: string }) => {
  const layers: SettingsLayerInput[] = [
    {
      layer: ESettingsLayer.User,
      origin: 'user',
      values: args.configured === undefined ? {} : { [ESettingId.CloudUrl]: args.configured },
    },
  ]
  const resolution = resolveSettings({ definitions, layers })
  return {
    cloud: { session: () => (args.sessionUrl === null ? null : { url: args.sessionUrl }) },
    settings: { snapshot: () => ({ resolution }) },
  }
}

describe('cloudUrlOf', () => {
  it('hands the signed-in session API to serve, ahead of the setting', () => {
    const app = appWith({ sessionUrl: 'https://api.custom.test', configured: 'https://other.test' })

    expect(cloudUrlOf(app)).toBe('https://api.custom.test')
  })

  it('falls back to the configured Cloud URL when signed out', () => {
    expect(cloudUrlOf(appWith({ sessionUrl: null, configured: 'https://self-hosted.test' }))).toBe(
      'https://self-hosted.test',
    )
  })

  it('falls back to the built-in default when neither is set', () => {
    expect(cloudUrlOf(appWith({ sessionUrl: null }))).toBe('https://api.byatlas.io')
  })
})
