import { describe, expect, it } from 'bun:test'

import { AgentHostEnvError, readAgentHostEnv } from '../env'

const complete: Record<string, string> = {
  DATABASE_URL: 'postgres://x',
  DATABASE_DIRECT_URL: 'postgres://direct',
  REDIS_URL: 'redis://x',
  DAEMON_SECRET: 'secret',
  SECRETS_ENCRYPTION_KEY: 'k'.repeat(64),
  ATLAS_API_ORIGIN: 'https://api.byatlas.io',
  CLOUDFLARE_API_TOKEN: 'cf-token',
  CLOUDFLARE_ACCOUNT_ID: 'cf-account',
  CLOUDFLARE_ZONE_ID: 'cf-zone',
}

describe('readAgentHostEnv', () => {
  it('reads the required vars and applies defaults', () => {
    const env = readAgentHostEnv(complete)
    expect(env.databaseUrl).toBe('postgres://x')
    expect(env.databaseDirectUrl).toBe('postgres://direct')
    expect(env.daemonSecret).toBe('secret')
    expect(env.secretsEncryptionKey).toBe('k'.repeat(64))
    expect(env.apiOrigin).toBe('https://api.byatlas.io')
    expect(env.cloudflare).toEqual({
      apiToken: 'cf-token',
      accountId: 'cf-account',
      zoneId: 'cf-zone',
    })
    expect(env.previewDomain).toBe('byatlas.dev')
    expect(env.vercelOauth).toBeNull()
    expect(env.mediaBlobToken).toBeNull()
    expect(env.githubApp).toEqual({ appId: undefined, appPrivateKey: undefined })
    expect(env.sandboxImage).toBe('atlas-sandbox:latest')
    expect(env.daemonBundlePath.endsWith('apps/daemon/bin/daemon.js')).toBe(true)
    expect(env.jinaApiKey).toBeUndefined()
  })

  it('reads the jina key the web tools search with', () => {
    expect(readAgentHostEnv({ ...complete, JINA_API_KEY: 'jina' }).jinaApiKey).toBe('jina')
  })

  it('reads the vercel oauth client only when both halves are set', () => {
    expect(readAgentHostEnv({ ...complete, VERCEL_OAUTH_CLIENT_ID: 'cl' }).vercelOauth).toBeNull()
    expect(
      readAgentHostEnv({
        ...complete,
        VERCEL_OAUTH_CLIENT_ID: 'cl',
        VERCEL_OAUTH_CLIENT_SECRET: 'sec',
      }).vercelOauth,
    ).toEqual({ clientId: 'cl', clientSecret: 'sec' })
  })

  it('reads the platform vercel triple only when all three are set', () => {
    expect(readAgentHostEnv(complete).platformVercel).toBeNull()
    expect(
      readAgentHostEnv({
        ...complete,
        PLATFORM_VERCEL_TOKEN: 'token',
        PLATFORM_VERCEL_TEAM_ID: 'team',
        PLATFORM_VERCEL_PROJECT_ID: 'prj',
      }).platformVercel,
    ).toEqual({ token: 'token', teamId: 'team', projectId: 'prj' })
  })

  it('names the platform vars a partial vercel triple is missing', () => {
    let thrown: unknown
    try {
      readAgentHostEnv({ ...complete, PLATFORM_VERCEL_TOKEN: 'token' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(AgentHostEnvError)
    expect((thrown as AgentHostEnvError).missing).toEqual([
      'PLATFORM_VERCEL_TEAM_ID',
      'PLATFORM_VERCEL_PROJECT_ID',
    ])
  })

  it('reads agent37 only with an api key and a template, defaulting the shape', () => {
    expect(readAgentHostEnv({ ...complete, AGENT37_API_KEY: 'key' }).agent37).toBeNull()
    expect(
      readAgentHostEnv({ ...complete, AGENT37_TEMPLATE_ID: 'atlas-sandbox@3' }).agent37,
    ).toBeNull()
    expect(
      readAgentHostEnv({
        ...complete,
        AGENT37_API_KEY: 'key',
        AGENT37_TEMPLATE_ID: 'atlas-sandbox@3',
      }).agent37,
    ).toEqual({
      apiKey: 'key',
      template: 'atlas-sandbox@3',
      resources: { cpu: 2, memory: 4, disk: 20 },
    })
    expect(
      readAgentHostEnv({
        ...complete,
        AGENT37_API_KEY: 'key',
        AGENT37_TEMPLATE_ID: 'atlas-sandbox@3',
        AGENT37_CPU: '4',
        AGENT37_MEMORY_GB: '8',
        AGENT37_DISK_GB: '40',
      }).agent37?.resources,
    ).toEqual({ cpu: 4, memory: 8, disk: 40 })
    expect(() =>
      readAgentHostEnv({
        ...complete,
        AGENT37_API_KEY: 'key',
        AGENT37_TEMPLATE_ID: 'atlas-sandbox@3',
        AGENT37_CPU: '0',
      }),
    ).toThrow(AgentHostEnvError)
  })

  it('reads the media blob token when it is set', () => {
    expect(
      readAgentHostEnv({ ...complete, BLOB_READ_WRITE_TOKEN: 'blob-token' }).mediaBlobToken,
    ).toBe('blob-token')
    expect(readAgentHostEnv({ ...complete, BLOB_READ_WRITE_TOKEN: '  ' }).mediaBlobToken).toBeNull()
  })

  it('honours the overrides', () => {
    const env = readAgentHostEnv({
      ...complete,
      ATLAS_SANDBOX_IMAGE: 'ghcr.io/x/atlas-sandbox:sha-abc',
      ATLAS_DAEMON_BUNDLE: '/tmp/daemon.js',
    })
    expect(env.sandboxImage).toBe('ghcr.io/x/atlas-sandbox:sha-abc')
    expect(env.daemonBundlePath).toBe('/tmp/daemon.js')
  })

  it('lists every missing required var', () => {
    let thrown: unknown
    try {
      readAgentHostEnv({})
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(AgentHostEnvError)
    const missing = (thrown as AgentHostEnvError).missing
    expect(missing).toEqual([
      'DATABASE_URL',
      'DATABASE_DIRECT_URL',
      'REDIS_URL',
      'DAEMON_SECRET',
      'SECRETS_ENCRYPTION_KEY',
      'ATLAS_API_ORIGIN',
      'CLOUDFLARE_API_TOKEN',
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_ZONE_ID',
    ])
  })

  it('takes DIRECT_URL when DATABASE_DIRECT_URL is absent', () => {
    const { DATABASE_DIRECT_URL: _direct, ...withoutDirect } = complete
    const env = readAgentHostEnv({ ...withoutDirect, DIRECT_URL: 'postgres://api-direct' })

    expect(env.databaseDirectUrl).toBe('postgres://api-direct')
  })

  it('defaults the stream port and origins, and reads PORT and TRUSTED_ORIGINS', () => {
    const defaults = readAgentHostEnv(complete)
    expect(defaults.port).toBe(10_000)
    expect(defaults.trustedOrigins).toEqual([])
    const set = readAgentHostEnv({
      ...complete,
      PORT: '8080',
      TRUSTED_ORIGINS: 'https://a.example, https://b.example,,',
    })
    expect(set.port).toBe(8080)
    expect(set.trustedOrigins).toEqual(['https://a.example', 'https://b.example'])
    expect(() => readAgentHostEnv({ ...complete, PORT: 'x' })).toThrow(AgentHostEnvError)
  })
})
