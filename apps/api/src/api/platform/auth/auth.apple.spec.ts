import { describe, expect, it } from 'bun:test'
import { auth } from './auth.server'

describe('apple provider gating', () => {
  it('registers the apple provider only when APPLE_APP_BUNDLE_IDENTIFIER is set', () => {
    expect(auth.options.socialProviders?.apple).toBeUndefined()
  })

  it('trusts google and apple for account linking', () => {
    expect(auth.options.account?.accountLinking?.trustedProviders).toEqual(['google', 'apple'])
  })
})
