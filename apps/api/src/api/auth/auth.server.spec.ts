import { describe, expect, it } from 'vitest'
import { auth } from './auth.server'

describe('auth server', () => {
  it('constructs with the email, organization, bearer, and device flows', () => {
    expect(typeof auth.api.signUpEmail).toBe('function')
    expect(typeof auth.api.createOrganization).toBe('function')
    expect(typeof auth.api.deviceCode).toBe('function')
    expect(typeof auth.api.deviceApprove).toBe('function')
    expect(typeof auth.api.getSession).toBe('function')
  })
})
