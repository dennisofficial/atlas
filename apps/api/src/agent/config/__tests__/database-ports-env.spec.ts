import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { accessSourceOf } from '../access-grants'
import { cloudConfigStore } from '../cloud-config-store'
import { InsecureDatabaseUrlError } from '../database-url'
import { envSecretsReader } from '../env-secrets'
import { mcpControlPort, offlineMacLink } from '../mcp-control'
import { projectFilesSourceOf } from '../project-files'

const insecureUrlOf = (host: string): string => `postgres://u:p@${host}/atlas?sslmode=disable`

const hostEnv = {
  databaseUrl: insecureUrlOf('host-env.invalid'),
  secretsEncryptionKey: 'k'.repeat(64),
  publicUrl: 'https://api.byatlas.io',
}

const processEnv: Record<string, string> = {
  DATABASE_URL: insecureUrlOf('process-env.invalid'),
  DATABASE_DIRECT_URL: 'postgres://direct',
  REDIS_URL: 'redis://x',
  DAEMON_SECRET: 'secret',
  SECRETS_ENCRYPTION_KEY: 'p'.repeat(64),
  ATLAS_API_ORIGIN: 'https://api.byatlas.io',
  CLOUDFLARE_API_TOKEN: 'cf-token',
  CLOUDFLARE_ACCOUNT_ID: 'cf-account',
  CLOUDFLARE_ZONE_ID: 'cf-zone',
}

const lookup = { userId: 'user-1', projectId: 'project-1' }

const failureOf = async (open: () => unknown): Promise<unknown> => {
  try {
    await open()
  } catch (error) {
    return error
  }
  return undefined
}

const expectOpensHostEnvDatabase = (error: unknown): void => {
  expect(error).toBeInstanceOf(InsecureDatabaseUrlError)
  expect((error as Error).message).toContain('host-env.invalid')
}

describe('database-backed config ports', () => {
  const saved = new Map<string, string | undefined>()

  beforeEach(() => {
    for (const [key, value] of Object.entries(processEnv)) {
      saved.set(key, process.env[key])
      process.env[key] = value
    }
  })

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    saved.clear()
  })

  it('opens the access source on the host env database', async () => {
    expectOpensHostEnvDatabase(await failureOf(() => accessSourceOf(hostEnv).read(lookup)))
  })

  it('opens the cloud config store on the host env database', async () => {
    expectOpensHostEnvDatabase(
      await failureOf(() => cloudConfigStore(hostEnv).forProject('project-1')),
    )
  })

  it('opens the env secrets reader on the host env database', async () => {
    expectOpensHostEnvDatabase(await failureOf(() => envSecretsReader(hostEnv).read(lookup)))
  })

  it('opens the project files source on the host env database', async () => {
    expectOpensHostEnvDatabase(await failureOf(() => projectFilesSourceOf(hostEnv).read(lookup)))
  })

  it('opens the mcp control port on the host env database', async () => {
    expectOpensHostEnvDatabase(
      await failureOf(() => mcpControlPort({ env: hostEnv, macLink: offlineMacLink }).of('s-1')),
    )
  })
})
