import {
  ATLAS_SETTINGS,
  EClassifierMode,
  ESettingsLayer,
  ESettingId,
  EWebSearchBackend,
  resolveSettings,
  type SettingsLayerInput,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { cloudEnvironmentOf } from '../app'

const resolutionWith = (values: Record<string, unknown>) => {
  const layers: SettingsLayerInput[] = [
    { layer: ESettingsLayer.User, origin: 'user', values },
  ]
  return resolveSettings({ definitions: ATLAS_SETTINGS, layers })
}

describe('cloudEnvironmentOf', () => {
  it('carries the decision URL, classifier mode, and search backend into sandbox env names', () => {
    const env = cloudEnvironmentOf(
      resolutionWith({
        [ESettingId.DecisionsUrl]: 'https://api.typesafe.ai',
        [ESettingId.ClassifierMode]: EClassifierMode.Nudge,
        [ESettingId.WebSearchBackend]: EWebSearchBackend.Brave,
      }),
    )

    expect(env).toEqual({
      ATLAS_DECISIONS_URL: 'https://api.typesafe.ai',
      ATLAS_CLASSIFIER_MODE: 'nudge',
      ATLAS_SEARCH_BACKEND: 'brave',
    })
  })

  it('omits a setting the operator never set so the sandbox reads its own fallback', () => {
    const env = cloudEnvironmentOf(resolutionWith({}))

    expect(env).toEqual({})
  })

  it('omits a setting still at its built-in default even when the default is non-empty', () => {
    const env = cloudEnvironmentOf(resolutionWith({}))

    expect(env).not.toHaveProperty('ATLAS_CLASSIFIER_MODE')
    expect(env).not.toHaveProperty('ATLAS_SEARCH_BACKEND')
  })

  it('omits an empty decision URL rather than handing the sandbox an empty string', () => {
    const env = cloudEnvironmentOf(
      resolutionWith({ [ESettingId.DecisionsUrl]: '' }),
    )

    expect(env).not.toHaveProperty('ATLAS_DECISIONS_URL')
  })
})
