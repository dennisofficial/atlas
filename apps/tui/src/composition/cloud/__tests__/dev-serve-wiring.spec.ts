import { afterEach, describe, expect, it } from 'bun:test'

import { ATLAS_SETTINGS, ESettingId, SecretsPort } from '@dltech/atlas-core'
import {
  CLOUD_SETTING_DEFINITIONS,
  createSettingsService,
  isCloudSettingId,
  MemorySettingsStore,
} from '@dltech/atlas-harness'

import { liveBridgeOptionsFor } from '../../live-cloud'
import type { AtlasApp } from '../../compose'

class FakeSecrets extends SecretsPort {
  origin(): string {
    return 'fake'
  }

  read(name: string): string | undefined {
    return name === ESettingId.VercelToken ? 'vercel-token' : undefined
  }

  write(): void {
    throw new Error('unused')
  }

  remove(): void {
    throw new Error('unused')
  }
}

const appWith = (values: Record<string, string>): AtlasApp => {
  const settings = createSettingsService({
    definitions: [
      ...ATLAS_SETTINGS.filter((definition) => !isCloudSettingId(definition.id)),
      ...CLOUD_SETTING_DEFINITIONS,
    ],
    user: new MemorySettingsStore({
      document: {
        values: {
          [ESettingId.VercelTeamId]: 'team_1',
          [ESettingId.VercelProjectId]: 'prj_1',
          ...values,
        },
      },
    }),
  })
  return { settings, secrets: new FakeSecrets() } as unknown as AtlasApp
}

const releaseGlobal: Record<string, unknown> = globalThis

afterEach(() => {
  delete releaseGlobal.ATLAS_VERSION
})

describe('liveBridgeOptionsFor sandbox serve', () => {
  it('hands a source build a dev serve resolver and no release pin', () => {
    const config = liveBridgeOptionsFor(appWith({})).vercel()

    expect(typeof config.devServe).toBe('function')
    expect(config.serveVersion).toBeUndefined()
  })

  it('pins a release build to its own version with no dev serve', () => {
    releaseGlobal.ATLAS_VERSION = '9.9.9'

    const config = liveBridgeOptionsFor(appWith({})).vercel()

    expect(config.serveVersion).toBe('9.9.9')
    expect(config.devServe).toBeUndefined()
  })

  it('pins nothing under an operator-set image, even from source', () => {
    const config = liveBridgeOptionsFor(
      appWith({ [ESettingId.SandboxImage]: 'my/image:1' }),
    ).vercel()

    expect(config.image).toBe('my/image:1')
    expect(config.devServe).toBeUndefined()
    expect(config.serveVersion).toBeUndefined()
  })
})
