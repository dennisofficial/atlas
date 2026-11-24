import { describe, expect, it } from 'bun:test'
import { validatedEnvService } from './validated-env'

const VALID_ENV = {
  DATABASE_URL: 'postgresql://atlas:atlas@localhost:5433/atlas',
  SECRET_KEY: 'a-secret-key-with-at-least-32-characters',
  SECRETS_ENCRYPTION_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  TRIGGER_SECRET_KEY: 'tr_dev_test-fixture-not-a-real-key',
  TRIGGER_JOBS_SECRET_KEY: 'tr_dev_test-fixture-not-a-real-key',
  GOOGLE_CLIENT_ID: 'test-google-client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  RESEND_API_KEY: 're_test_fixture_not_a_real_key',
  CLOUDFLARE_API_TOKEN: 'cf-test-token',
  CLOUDFLARE_ACCOUNT_ID: 'cf-test-account',
  CLOUDFLARE_ZONE_ID: 'cf-test-zone',
}

describe('validatedEnvService', () => {
  it('answers the port the environment names, as a number', () => {
    expect(validatedEnvService({ ...VALID_ENV, PORT: '4100' }).get('PORT')).toBe(4100)
  })

  it('answers the default port when the environment names none', () => {
    expect(validatedEnvService(VALID_ENV).get('PORT')).toBe(3400)
  })

  it('refuses an invalid environment and names the bad key', () => {
    expect(() => validatedEnvService({ ...VALID_ENV, DATABASE_URL: 'mysql://nope' })).toThrow(
      /invalid environment:[\s\S]*DATABASE_URL/,
    )
  })
})
