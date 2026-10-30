import { ATLAS_SETTINGS, ESettingKind, isLocalSetting } from '@dltech/atlas-core'
import { CLOUD_SETTING_REGISTRY } from '@dltech/atlas-wire/web'
import { describe, expect, it } from 'bun:test'

import { CLOUD_SETTING_DEFINITIONS } from '../../cloud/settings-definitions'

const cloudIds = [...ATLAS_SETTINGS, ...CLOUD_SETTING_DEFINITIONS]
  .filter((definition) => !isLocalSetting(definition))
  .filter((definition) => definition.kind !== ESettingKind.Secret)
  .map((definition) => definition.id)

describe('cloud setting completeness', () => {
  it('registers every cloud definition in the wire registry', () => {
    expect(cloudIds.filter((id) => !CLOUD_SETTING_REGISTRY.has(id))).toEqual([])
  })
})
