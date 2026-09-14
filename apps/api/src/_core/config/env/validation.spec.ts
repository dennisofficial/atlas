import { describe, expect, it } from 'vitest'
import { envConfigValidation } from './validation'

const VALID_ENV = {
  DATABASE_URL: 'postgresql://atlas:atlas@localhost:5433/atlas',
  SECRET_KEY: 'a-secret-key-with-at-least-32-characters',
  SECRETS_ENCRYPTION_KEY:
    'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
}

function validate(env: Record<string, string>) {
  return envConfigValidation.validate(env, { allowUnknown: true, abortEarly: false })
}

describe('envConfigValidation', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const { error, value } = validate(VALID_ENV)
    expect(error).toBeUndefined()
    expect(value.APP_TIER).toBe('local')
    expect(value.PORT).toBe(3400)
    expect(value.BETTER_AUTH_URL).toBe('http://localhost:3400')
  })

  it('reports every missing required key at once', () => {
    const { error } = validate({})
    expect(error?.message).toContain('DATABASE_URL')
    expect(error?.message).toContain('SECRET_KEY')
    expect(error?.message).toContain('SECRETS_ENCRYPTION_KEY')
  })

  it('rejects a short SECRET_KEY', () => {
    const { error } = validate({ ...VALID_ENV, SECRET_KEY: 'short' })
    expect(error?.message).toContain('SECRET_KEY')
  })

  it('rejects a non-postgres DATABASE_URL', () => {
    const { error } = validate({ ...VALID_ENV, DATABASE_URL: 'mysql://localhost/db' })
    expect(error?.message).toContain('DATABASE_URL')
  })

  it('coerces PORT to a number', () => {
    const { error, value } = validate({ ...VALID_ENV, PORT: '3600' })
    expect(error).toBeUndefined()
    expect(value.PORT).toBe(3600)
  })
})
