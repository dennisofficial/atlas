import { describe, expect, it } from 'bun:test'
import { ESandboxProvider } from '@dltech/atlas-protocol'

import { platformCredentialsOf } from '../platform-credentials'

const NO_PLATFORM = { platformVercel: null, agent37: null }

describe('platformCredentialsOf', () => {
  it('reads the vercel triple from the env', () => {
    const credentials = platformCredentialsOf({
      provider: ESandboxProvider.Vercel,
      env: {
        platformVercel: { token: 'token', teamId: 'team', projectId: 'prj' },
        agent37: null,
      },
    })
    expect(credentials).toEqual({
      provider: ESandboxProvider.Vercel,
      token: 'token',
      teamId: 'team',
      projectId: 'prj',
    })
  })

  it('reads the agent37 api key from the env', () => {
    expect(
      platformCredentialsOf({
        provider: ESandboxProvider.Agent37,
        env: {
          platformVercel: null,
          agent37: {
            apiKey: 'a37-key',
            template: 'atlas-sandbox@3',
            resources: { cpu: 2, memory: 4, disk: 20 },
          },
        },
      }),
    ).toEqual({ provider: ESandboxProvider.Agent37, apiKey: 'a37-key' })
  })

  it('reports the platform gap when the env holds no credential for the provider', () => {
    expect(platformCredentialsOf({ provider: ESandboxProvider.Vercel, env: NO_PLATFORM })).toEqual({
      configured: false,
      gap: 'platform-credential',
    })
    expect(platformCredentialsOf({ provider: ESandboxProvider.Agent37, env: NO_PLATFORM })).toEqual(
      { configured: false, gap: 'platform-credential' },
    )
  })
})
