import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { injectEncryptedTierEnv } from './tier-env'

const DOTENVX = join(import.meta.dirname, '..', '..', 'node_modules', '.bin', 'dotenvx')
const TIER_FILE = '.env.api.production.enc'
const PRIVATE_KEY_VAR = 'DOTENV_PRIVATE_KEY_API_PRODUCTION'
const PROBE_KEYS = ['TIER_PROBE_ONE', 'TIER_PROBE_TWO']

let envsDir: string
let privateKey: string

const SAVED_ENV = { ...process.env }

function envWithoutDotenvKeys(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('DOTENV_')),
  )
}

beforeAll(() => {
  envsDir = mkdtempSync(join(tmpdir(), 'atlas-tier-env-'))
  const run = (key: string, value: string): void => {
    execFileSync(DOTENVX, ['set', key, value, '-f', TIER_FILE], {
      cwd: envsDir,
      stdio: 'pipe',
      env: envWithoutDotenvKeys(),
    })
  }
  run('TIER_PROBE_ONE', 'first-value')
  run('TIER_PROBE_TWO', 'second-value')
  const keys = readFileSync(join(envsDir, '.env.keys'), 'utf8')
  const match = new RegExp(`${PRIVATE_KEY_VAR}="?([0-9a-f]{64})"?`).exec(keys)
  if (match === null) throw new Error('no private key in generated .env.keys')
  privateKey = match[1] as string
  rmSync(join(envsDir, '.env.keys'))
  return () => rmSync(envsDir, { recursive: true, force: true })
})

afterEach(() => {
  for (const key of [...PROBE_KEYS, PRIVATE_KEY_VAR, 'DOTENVX_ENVS_DIR']) delete process.env[key]
  Object.assign(process.env, SAVED_ENV)
})

describe('injectEncryptedTierEnv', () => {
  it('injects decrypted values when the private key matches', () => {
    process.env.DOTENVX_ENVS_DIR = envsDir
    process.env[PRIVATE_KEY_VAR] = privateKey

    injectEncryptedTierEnv()

    expect(process.env.TIER_PROBE_ONE).toBe('first-value')
    expect(process.env.TIER_PROBE_TWO).toBe('second-value')
  })

  it('throws naming a key when the private key is wrong', () => {
    process.env.DOTENVX_ENVS_DIR = envsDir
    process.env[PRIVATE_KEY_VAR] = '0'.repeat(64)

    expect(() => injectEncryptedTierEnv()).toThrow(/TIER_PROBE_ONE/)
  })

  it('throws when no private key is provided', () => {
    process.env.DOTENVX_ENVS_DIR = envsDir
    delete process.env[PRIVATE_KEY_VAR]

    expect(() => injectEncryptedTierEnv()).toThrow()
    expect(process.env.TIER_PROBE_ONE).not.toBe('first-value')
  })

  it('throws when the tier file is missing from the configured directory', () => {
    process.env.DOTENVX_ENVS_DIR = join(envsDir, 'nowhere')

    expect(() => injectEncryptedTierEnv()).toThrow(/was not found in the deployed bundle/)
  })

  it('does nothing when DOTENVX_ENVS_DIR is unset', () => {
    delete process.env.DOTENVX_ENVS_DIR

    expect(() => injectEncryptedTierEnv()).not.toThrow()
    expect(process.env.TIER_PROBE_ONE).toBeUndefined()
  })
})
