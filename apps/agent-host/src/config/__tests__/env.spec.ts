import { describe, expect, it } from 'bun:test'

import { AgentHostEnvError, readAgentHostEnv } from '../env'

const complete: Record<string, string> = {
  DATABASE_URL: 'postgres://x',
  DATABASE_DIRECT_URL: 'postgres://direct',
  REDIS_URL: 'redis://x',
  DAEMON_SECRET: 'secret',
  SECRETS_ENCRYPTION_KEY: 'k'.repeat(64),
  ATLAS_API_ORIGIN: 'https://api.byatlas.io',
}

describe('readAgentHostEnv', () => {
  it('reads the required vars and applies defaults', () => {
    const env = readAgentHostEnv(complete)
    expect(env.databaseUrl).toBe('postgres://x')
    expect(env.databaseDirectUrl).toBe('postgres://direct')
    expect(env.daemonSecret).toBe('secret')
    expect(env.secretsEncryptionKey).toBe('k'.repeat(64))
    expect(env.apiOrigin).toBe('https://api.byatlas.io')
    expect(env.vercelOauth).toBeNull()
    expect(env.maxSessions).toBe(25)
    expect(env.sandboxImage).toBe('atlas-sandbox:latest')
    expect(env.daemonBundlePath.endsWith('apps/daemon/bin/daemon.js')).toBe(true)
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

  it('honours the overrides', () => {
    const env = readAgentHostEnv({
      ...complete,
      AGENT_HOST_MAX_SESSIONS: '7',
      ATLAS_SANDBOX_IMAGE: 'ghcr.io/x/atlas-sandbox:sha-abc',
      ATLAS_DAEMON_BUNDLE: '/tmp/daemon.js',
    })
    expect(env.maxSessions).toBe(7)
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
    ])
  })

  it('rejects a non-integer AGENT_HOST_MAX_SESSIONS', () => {
    expect(() => readAgentHostEnv({ ...complete, AGENT_HOST_MAX_SESSIONS: 'many' })).toThrow(
      AgentHostEnvError,
    )
  })
})
