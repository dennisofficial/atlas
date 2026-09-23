import { describe, expect, it } from 'bun:test'

import { ATLAS_SETTINGS, ESettingId, SecretsPort } from '@dltech/atlas-core'

import { createSettingsService, MemorySettingsStore } from '../../settings'
import {
  requireVercelCredentials,
  sandboxImageOf,
  VercelNotConfiguredError,
} from '../vercel-credentials'

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

const settingsWith = (values: Record<string, string>) =>
  createSettingsService({
    definitions: ATLAS_SETTINGS,
    user: new MemorySettingsStore({ document: { values } }),
  })

const FULL = {
  [ESettingId.VercelTeamId]: 'team_123',
  [ESettingId.VercelProjectId]: 'prj_123',
}

describe('requireVercelCredentials', () => {
  it('reads the token from the secrets file and the scoping from settings', () => {
    const credentials = requireVercelCredentials({
      settings: settingsWith(FULL),
      secrets: new FakeSecrets({ [ESettingId.VercelToken]: 'vercel-token-1' }),
    })

    expect(credentials).toEqual({
      token: 'vercel-token-1',
      teamId: 'team_123',
      projectId: 'prj_123',
    })
  })

  it('teaches the token first when nothing is set up', () => {
    const failure = () =>
      requireVercelCredentials({
        settings: settingsWith(FULL),
        secrets: new FakeSecrets({}),
      })

    expect(failure).toThrow(VercelNotConfiguredError)
    expect(failure).toThrow('add your Vercel token')
  })

  it('never accepts the token from a settings file or the environment', () => {
    const failure = () =>
      requireVercelCredentials({
        settings: settingsWith({ ...FULL, [ESettingId.VercelToken]: 'pasted-into-settings' }),
        secrets: new FakeSecrets({}),
      })

    expect(failure).toThrow(VercelNotConfiguredError)
  })

  it('names the team when only it is missing', () => {
    const failure = () =>
      requireVercelCredentials({
        settings: settingsWith({ [ESettingId.VercelProjectId]: 'prj_123' }),
        secrets: new FakeSecrets({ [ESettingId.VercelToken]: 'vercel-token-1' }),
      })

    expect(failure).toThrow('add your Vercel team ID')
  })

  it('names the project when only it is missing', () => {
    const failure = () =>
      requireVercelCredentials({
        settings: settingsWith({ [ESettingId.VercelTeamId]: 'team_123' }),
        secrets: new FakeSecrets({ [ESettingId.VercelToken]: 'vercel-token-1' }),
      })

    expect(failure).toThrow('add your Vercel project ID')
  })
})

describe('sandboxImageOf', () => {
  const release = { version: '1.4.2', buildSha: 'f'.repeat(40) }

  it('falls back to the published image', () => {
    expect(sandboxImageOf({ settings: settingsWith({}) })).toEqual({
      image: 'atlas-sandbox:latest',
      serveSources: [],
    })
  })

  it('pins a release build to its own tag and trusts the serve baked into it', () => {
    expect(sandboxImageOf({ settings: settingsWith({}), release })).toEqual({
      image: 'atlas-sandbox:1.4.2',
      serveSources: [`source:${'f'.repeat(40)}`],
    })
  })

  it('follows the setting when one is pinned', () => {
    expect(
      sandboxImageOf({
        settings: settingsWith({ [ESettingId.SandboxImage]: 'vcr.vercel.example/team/atlas:v1' }),
      }),
    ).toEqual({ image: 'vcr.vercel.example/team/atlas:v1', serveSources: [] })
  })

  it('lets an operator-set image win over the release pin, with no baked-serve trust', () => {
    expect(
      sandboxImageOf({
        settings: settingsWith({ [ESettingId.SandboxImage]: 'vcr.vercel.example/team/atlas:v1' }),
        release,
      }),
    ).toEqual({ image: 'vcr.vercel.example/team/atlas:v1', serveSources: [] })
  })
})
