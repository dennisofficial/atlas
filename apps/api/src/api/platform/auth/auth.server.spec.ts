import { describe, expect, it } from 'bun:test'
import { auth } from './auth.server'

describe('auth server', () => {
  it('constructs with the email, bearer, and device flows', () => {
    expect(typeof auth.api.signUpEmail).toBe('function')
    expect(typeof auth.api.deviceCode).toBe('function')
    expect(typeof auth.api.deviceApprove).toBe('function')
    expect(typeof auth.api.getSession).toBe('function')
  })

  it('sends Google back to the web origin, where the proxied auth cookies live', () => {
    expect(auth.options.socialProviders?.google?.redirectURI).toBe(
      'http://localhost:3001/api/auth/callback/google',
    )
  })

  it('delivers password reset emails and has no organization plugin', () => {
    expect(typeof auth.options.emailAndPassword?.sendResetPassword).toBe('function')
    expect(auth.options.emailAndPassword?.revokeSessionsOnPasswordReset).toBe(true)
    expect(auth.options.plugins.map((plugin) => plugin.id)).toEqual([
      'bearer',
      'device-authorization',
    ])
  })
})
