import { describe, expect, it } from 'vitest'

import {
  ATLAS_SETTINGS,
  EHarnessPlacement,
  ESettingId,
  EToolEnvironment,
  SecretsPort,
} from '@dltech/atlas-core'

import { createSettingsService, MemorySettingsStore } from '../../settings'
import { bornPlacementFor, cloudProvisioningConfigured } from '../born-placement'
import { CLOUD_SETTING_DEFINITIONS, isCloudSettingId } from '../settings-definitions'

class FakeSecrets extends SecretsPort {
  constructor(private readonly held: Record<string, string>) {
    super()
  }

  origin(): string {
    return 'fake'
  }

  read(name: string): string | undefined {
    return this.held[name]
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

const SCOPING = {
  [ESettingId.VercelTeamId]: 'team_1',
  [ESettingId.VercelProjectId]: 'prj_1',
}
const TOKEN = { [ESettingId.VercelToken]: 'vercel-token' }

describe('bornPlacementFor', () => {
  it('is the host on a fully configured machine', () => {
    const placement = bornPlacementFor({
      settings: settingsWith(SCOPING),
      secrets: new FakeSecrets(TOKEN),
    })

    expect(placement).toEqual({ harness: EHarnessPlacement.Host, tools: EToolEnvironment.Host })
  })

  it('is the host on an unconfigured machine', () => {
    const placement = bornPlacementFor({ settings: settingsWith({}), secrets: new FakeSecrets({}) })

    expect(placement).toEqual({ harness: EHarnessPlacement.Host, tools: EToolEnvironment.Host })
  })

  it('is the host even when the last born placement was the cloud', () => {
    const placement = bornPlacementFor({
      settings: settingsWith({ ...SCOPING, [ESettingId.LastBornPlacement]: 'cloud' }),
      secrets: new FakeSecrets(TOKEN),
    })

    expect(placement.harness).toBe(EHarnessPlacement.Host)
  })
})

describe('cloudProvisioningConfigured', () => {
  it('needs the token, the team and the project', () => {
    expect(
      cloudProvisioningConfigured({
        settings: settingsWith(SCOPING),
        secrets: new FakeSecrets(TOKEN),
      }),
    ).toBe(true)
  })

  it('is false without the token', () => {
    expect(
      cloudProvisioningConfigured({
        settings: settingsWith(SCOPING),
        secrets: new FakeSecrets({}),
      }),
    ).toBe(false)
  })

  it('is false with a blank token', () => {
    const secrets = new FakeSecrets({ [ESettingId.VercelToken]: '   ' })

    expect(cloudProvisioningConfigured({ settings: settingsWith(SCOPING), secrets })).toBe(false)
  })

  it('is false without the team', () => {
    const settings = settingsWith({ [ESettingId.VercelProjectId]: 'prj_1' })

    expect(cloudProvisioningConfigured({ settings, secrets: new FakeSecrets(TOKEN) })).toBe(false)
  })

  it('is false without the project', () => {
    const settings = settingsWith({ [ESettingId.VercelTeamId]: 'team_1' })

    expect(cloudProvisioningConfigured({ settings, secrets: new FakeSecrets(TOKEN) })).toBe(false)
  })
})
