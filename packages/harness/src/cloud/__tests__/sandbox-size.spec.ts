import { describe, expect, it } from 'bun:test'

import { ATLAS_SETTINGS, ESettingId } from '@dltech/atlas-core'

import { createSettingsService, MemorySettingsStore } from '../../settings'
import { CLOUD_SETTING_DEFINITIONS, isCloudSettingId } from '../settings-definitions'
import { sandboxVcpusOf } from '../sandbox-size'

const definitions = [
  ...ATLAS_SETTINGS.filter((definition) => !isCloudSettingId(definition.id)),
  ...CLOUD_SETTING_DEFINITIONS,
]

const settingsWith = (values: Record<string, string | number>) =>
  createSettingsService({
    definitions,
    user: new MemorySettingsStore({ document: { values } }),
  })

describe('sandboxVcpusOf', () => {
  it('falls back to two vCPUs', () => {
    expect(sandboxVcpusOf({ settings: settingsWith({}) })).toBe(2)
  })

  it('reads the operator size', () => {
    expect(sandboxVcpusOf({ settings: settingsWith({ [ESettingId.SandboxVcpus]: 8 }) })).toBe(8)
  })

  it('accepts a stored string', () => {
    expect(sandboxVcpusOf({ settings: settingsWith({ [ESettingId.SandboxVcpus]: '4' }) })).toBe(4)
  })
})
