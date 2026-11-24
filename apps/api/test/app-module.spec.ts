import { Test } from '@nestjs/testing'
import { describe, expect, it } from 'bun:test'
import { AppModule } from '../src/app.module'
import type { AgentHostEnv } from '../src/agent'
import { ApiModule } from '../src/api/api.module'

const agentEnv: AgentHostEnv = {
  databaseUrl: 'postgresql://atlas:atlas@localhost:5433/atlas',
  databaseDirectUrl: 'postgresql://atlas:atlas@localhost:5433/atlas',
  redisUrl: 'redis://localhost:6379',
  daemonSecret: 'test-daemon-secret',
  secretsEncryptionKey: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  apiOrigin: 'http://localhost:3400',
  cloudflare: { apiToken: 'cf-token', accountId: 'cf-account', zoneId: 'cf-zone' },
  previewDomain: 'byatlas.dev',
  vercelOauth: null,
  platformVercel: null,
  agent37: null,
  mediaBlobToken: null,
  githubApp: { appId: undefined, appPrivateKey: undefined },
  sandboxImage: 'atlas-sandbox:latest',
  daemonBundlePath: 'daemon.js',
  port: 3400,
  publicUrl: 'https://api.byatlas.io',
  trustedOrigins: [],
}

const AGENT_ENV_KEYS = {
  DATABASE_DIRECT_URL: agentEnv.databaseDirectUrl,
  REDIS_URL: agentEnv.redisUrl,
  DAEMON_SECRET: agentEnv.daemonSecret,
  ATLAS_API_ORIGIN: agentEnv.apiOrigin,
} as const

describe('AppModule', () => {
  it('resolves the module graph', async () => {
    for (const [key, value] of Object.entries(AGENT_ENV_KEYS)) process.env[key] = value
    try {
      const module = await Test.createTestingModule({
        imports: [AppModule.forRoot(agentEnv)],
      }).compile()
      expect(module).toBeDefined()
      await module.close()
    } finally {
      for (const key of Object.keys(AGENT_ENV_KEYS)) delete process.env[key]
    }
  }, 30_000)
})

describe('ApiModule', () => {
  it('resolves without the agent', async () => {
    const module = await Test.createTestingModule({ imports: [ApiModule] }).compile()
    expect(module).toBeDefined()
    await module.close()
  }, 30_000)
})
