import { describe, expect, it } from 'bun:test'

import {
  ATLAS_SETTINGS,
  EHarnessPlacement,
  EToolEnvironment,
  SecretsPort,
} from '@dltech/atlas-core'

import { createSettingsService, MemorySettingsStore } from '../../settings'
import { bornPlacementFor } from '../born-placement'
import { CLOUD_SETTING_DEFINITIONS, isCloudSettingId } from '../settings-definitions'

class FakeSecrets extends SecretsPort {
  origin(): string {
    return 'fake'
  }

  read(): string | undefined {
    return undefined
  }

  write(): void {
    throw new Error('unused')
  }

  remove(): void {
    throw new Error('unused')
  }
}

const definitions = [
  ...ATLAS_SETTINGS.filter((definition) => !isCloudSettingId(definition.id)),
  ...CLOUD_SETTING_DEFINITIONS,
]

const settingsWith = (values: Record<string, string | number>) =>
  createSettingsService({
    definitions,
    user: new MemorySettingsStore({ document: { values } }),
  })

describe('bornPlacementFor', () => {
  it('is the host on a fresh machine', () => {
    const placement = bornPlacementFor({ settings: settingsWith({}), secrets: new FakeSecrets() })

    expect(placement).toEqual({ harness: EHarnessPlacement.Host, tools: EToolEnvironment.Host })
  })

  it('is the host even when the last born placement was the cloud', () => {
    const placement = bornPlacementFor({
      settings: settingsWith({ 'placement.lastBorn': 'cloud' }),
      secrets: new FakeSecrets(),
    })

    expect(placement.harness).toBe(EHarnessPlacement.Host)
  })
})
