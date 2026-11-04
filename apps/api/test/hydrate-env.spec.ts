import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { hydrateEnvFromTierFile } from '../src/api/hydrate-env'

const DOTENVX = join(import.meta.dirname, '..', 'node_modules', '.bin', 'dotenvx')

let fixtureDir: string
let privateKey: string

const SAVED_ENV = { ...process.env }

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'atlas-hydrate-'))
  const childEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('DOTENV_')),
  )
  execFileSync(DOTENVX, ['set', 'HYDRATION_PROBE', 'hydrated-value', '-f', '.env.production.enc'], {
    cwd: fixtureDir,
    stdio: 'pipe',
    env: childEnv,
  })
  const keys = readFileSync(join(fixtureDir, '.env.keys'), 'utf8')
  const match = /DOTENV_PRIVATE_KEY[A-Z_]*="?([0-9a-f]{64})"?/.exec(keys)
  if (match === null) throw new Error('no private key in generated .env.keys')
  privateKey = match[1] as string
})

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in SAVED_ENV)) delete process.env[key]
  }
  Object.assign(process.env, SAVED_ENV)
})

describe('hydrateEnvFromTierFile', () => {
  it('hydrates from .env.<tier>.enc when a private key is present', () => {
    process.env.DOTENV_PRIVATE_KEY_PRODUCTION_ENC = privateKey
    process.env.APP_TIER = 'production'
    hydrateEnvFromTierFile({ cwd: fixtureDir })
    expect(process.env.HYDRATION_PROBE).toBe('hydrated-value')
  })

  it('finds the tier file under apps/api as well', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-hydrate-nested-'))
    mkdirSync(join(dir, 'apps', 'api'), { recursive: true })
    cpSync(join(fixtureDir, '.env.production.enc'), join(dir, 'apps', 'api', '.env.production.enc'))
    process.env.DOTENV_PRIVATE_KEY_PRODUCTION_ENC = privateKey
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
    process.env.DOTENV_PRIVATE_KEY_PRODUCTION_ENC = privateKey
    process.env.APP_TIER = 'production'
    expect(() => hydrateEnvFromTierFile({ cwd: dir })).not.toThrow()
  })
})
