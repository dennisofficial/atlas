import { describe, expect, it } from 'bun:test'
import {
  APP_REDIRECT_URI,
  beginGoogleReauthInputSchema,
  beginGoogleLinkInputSchema,
  beginGoogleReplySchema,
  authorizeDesktopInputSchema,
  exchangeDesktopCodeInputSchema,
  isAuthorizableRedirectUri,
  needsTrustedOrigin,
} from '../desktop-auth-wire'

const LOOPBACK = 'http://127.0.0.1:51234/desktop/auth/callback'
const CHALLENGE = 'a'.repeat(43)

describe('desktop auth redirect uris', () => {
  it('authorizes a loopback callback without a trusted origin', () => {
    expect(isAuthorizableRedirectUri(LOOPBACK)).toBe(true)
    expect(needsTrustedOrigin(LOOPBACK)).toBe(false)
  })

  it('authorizes the native app scheme without a trusted origin', () => {
    expect(isAuthorizableRedirectUri(APP_REDIRECT_URI)).toBe(true)
    expect(needsTrustedOrigin(APP_REDIRECT_URI)).toBe(false)
  })

  it('authorizes a web-app callback and flags it for the trusted-origin check', () => {
    const uri = 'https://app.example.test/auth/callback'
    expect(isAuthorizableRedirectUri(uri)).toBe(true)
    expect(needsTrustedOrigin(uri)).toBe(true)
    expect(isAuthorizableRedirectUri('http://localhost:8081/auth/callback')).toBe(true)
  })

  it('rejects exp://, other paths and other schemes', () => {
    expect(isAuthorizableRedirectUri('exp://192.168.1.2:8081')).toBe(false)
    expect(isAuthorizableRedirectUri('https://evil.test/auth/other')).toBe(false)
    expect(isAuthorizableRedirectUri('https://evil.test/auth/callback/extra')).toBe(false)
    expect(isAuthorizableRedirectUri('atlas://auth/other')).toBe(false)
    expect(isAuthorizableRedirectUri('https://evil.test/auth/callback?x=1')).toBe(false)
  })

  it('rejects an overlong uri at the schema boundary', () => {
    const uri = `${'https://a'.repeat(200)}.test/auth/callback`
    expect(authorizeDesktopInputSchema.safeParse({ redirectUri: uri }).success).toBe(false)
  })

  it('keeps old clients valid and validates Google begin bindings', () => {
    const input = {
      redirectUri: APP_REDIRECT_URI,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
    }
    expect(authorizeDesktopInputSchema.safeParse(input).success).toBe(true)
    expect(
      authorizeDesktopInputSchema.safeParse({ ...input, googleReauth: 'n'.repeat(43) }).success,
    ).toBe(true)
    expect(authorizeDesktopInputSchema.safeParse({ ...input, googleReauth: 'short' }).success).toBe(
      false,
    )
    expect(beginGoogleReauthInputSchema.safeParse({ ...input, state: 's' }).success).toBe(true)
    expect(beginGoogleReauthInputSchema.safeParse(input).success).toBe(false)
    expect(beginGoogleLinkInputSchema.safeParse({}).success).toBe(true)
    expect(beginGoogleLinkInputSchema.safeParse({ callbackURL: 'https://evil.test' }).success).toBe(
      false,
    )
    expect(
      beginGoogleReplySchema.safeParse({ url: 'https://api.byatlas.io/return/start/s' }).success,
    ).toBe(true)
  })

  it('accepts the app uri in both authorize and exchange inputs', () => {
    const authorize = authorizeDesktopInputSchema.safeParse({
      redirectUri: APP_REDIRECT_URI,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
    })
    expect(authorize.success).toBe(true)
    const exchange = exchangeDesktopCodeInputSchema.safeParse({
      code: 'c',
      codeVerifier: 'v'.repeat(43),
      redirectUri: 'https://app.example.test/auth/callback',
    })
    expect(exchange.success).toBe(true)
    expect(
      exchangeDesktopCodeInputSchema.safeParse({
        code: 'c',
        codeVerifier: 'v'.repeat(43),
        redirectUri: APP_REDIRECT_URI,
        requireGoogleReauth: true,
      }).success,
    ).toBe(true)
    expect(
      exchangeDesktopCodeInputSchema.safeParse({
        code: 'c',
        codeVerifier: 'v'.repeat(43),
        redirectUri: APP_REDIRECT_URI,
        requireGoogleReauth: 'yes',
      }).success,
    ).toBe(false)
  })
})
