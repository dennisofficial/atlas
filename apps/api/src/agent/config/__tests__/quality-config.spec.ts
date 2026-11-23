import { describe, expect, it } from 'bun:test'

import {
  ATLAS_SETTINGS,
  ESettingId,
  ESettingKind,
  singleResponsibilityPolicy,
} from '@dltech/atlas-core'
import { settingsWithProjectOverUser } from '@dltech/atlas-models'

import { qualityConfigOf } from '../quality-config'
import { setting } from './model-config.fixture'

const registryFallback = (id: ESettingId): boolean => {
  const held = ATLAS_SETTINGS.find((definition) => definition.id === id)
  if (held === undefined || held.kind !== ESettingKind.Toggle) {
    throw new Error(`the registry no longer holds ${id} as a toggle`)
  }
  return held.fallback
}

const settingsOf = (values: Record<string, unknown>): ReadonlyMap<string, string> =>
  new Map(Object.entries(values).map(([key, value]) => [key, setting(value)]))

describe('qualityConfigOf', () => {
  it('follows the registry fallback when nothing is stored', () => {
    expect(qualityConfigOf({ settings: new Map() })).toEqual({
      enabled: registryFallback(ESettingId.QualityEnabled),
      policies: {},
    })
  })

  it.each([true, false])('reads a stored master switch of %p', (enabled) => {
    expect(
      qualityConfigOf({ settings: settingsOf({ [ESettingId.QualityEnabled]: enabled }) }),
    ).toEqual({ enabled, policies: {} })
  })

  it('reads a stored policy switch by its setting key', () => {
    const config = qualityConfigOf({
      settings: settingsOf({ [singleResponsibilityPolicy.settingKey]: false }),
    })
    expect(config.policies[singleResponsibilityPolicy.settingKey]).toBe(false)
  })

  it('omits the policy when its value is not a boolean', () => {
    expect(
      qualityConfigOf({
        settings: settingsOf({ [singleResponsibilityPolicy.settingKey]: 'maybe' }),
      }).policies,
    ).toEqual({})
  })

  it('takes the project value over the user value at both switches', () => {
    const settings = settingsWithProjectOverUser({
      user: settingsOf({
        [ESettingId.QualityEnabled]: false,
        [singleResponsibilityPolicy.settingKey]: true,
      }),
      project: settingsOf({
        [ESettingId.QualityEnabled]: true,
        [singleResponsibilityPolicy.settingKey]: false,
      }),
    })
    expect(qualityConfigOf({ settings })).toEqual({
      enabled: true,
      policies: { [singleResponsibilityPolicy.settingKey]: false },
    })
  })
})
