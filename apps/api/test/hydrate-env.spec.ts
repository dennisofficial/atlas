import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { hydrateEnvFromTierFile } from '../src/api/hydrate-env'

const DOTENVX = join(__dirname, '..', 'node_modules', '.bin', 'dotenvx')

let fixtureDir: string
let privateKey: string

const SAVED_PRIVATE_KEYS = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.startsWith('DOTENV_PRIVATE_KEY')),
)

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'atlas-hydrate-'))
  const envs = join(fixtureDir, 'envs')
  mkdirSync(envs)
  const childEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('DOTENV_PRIVATE_KEY')),
  )
  execFileSync(
    DOTENVX,
    ['set', 'HYDRATION_PROBE', 'hydrated-value', '-f', '.env.api.production.enc'],
    { cwd: envs, stdio: 'pipe', env: childEnv },
  )
  const keys = readFileSync(join(envs, '.env.keys'), 'utf8')
  const match = /DOTENV_PRIVATE_KEY[A-Z_]*="?([0-9a-f]{64})"?/.exec(keys)
  if (match === null) throw new Error('no private key in generated .env.keys')
  privateKey = match[1] as string
})

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('DOTENV_PRIVATE_KEY')) delete process.env[key]
  }
  Object.assign(process.env, SAVED_PRIVATE_KEYS)
  delete process.env.HYDRATION_PROBE
  delete process.env.APP_TIER
})

describe('hydrateEnvFromTierFile', () => {
  it('hydrates from envs/<tier>.enc when a private key is present', () => {
    process.env.DOTENV_PRIVATE_KEY_API_PRODUCTION = privateKey
    process.env.APP_TIER = 'production'
    hydrateEnvFromTierFile({ cwd: fixtureDir })
    expect(process.env.HYDRATION_PROBE).toBe('hydrated-value')
  })

  it('finds the tier file under apps/api/envs as well', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-hydrate-nested-'))
    mkdirSync(join(dir, 'apps', 'api'), { recursive: true })
    cpSync(join(fixtureDir, 'envs'), join(dir, 'apps', 'api', 'envs'), { recursive: true })
    process.env.DOTENV_PRIVATE_KEY_API_PRODUCTION = privateKey
    process.env.APP_TIER = 'production'

    hydrateEnvFromTierFile({ cwd: dir })
    expect(process.env.HYDRATION_PROBE).toBe('hydrated-value')
  })

  it('does nothing without a private key', () => {
    process.env.APP_TIER = 'production'
    hydrateEnvFromTierFile({ cwd: fixtureDir })
    expect(process.env.HYDRATION_PROBE).toBeUndefined()
  })

  it('does nothing when the tier file is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-hydrate-empty-'))
    process.env.DOTENV_PRIVATE_KEY_API_PRODUCTION = privateKey
    process.env.APP_TIER = 'production'
    expect(() => hydrateEnvFromTierFile({ cwd: dir })).not.toThrow()
  })
})
