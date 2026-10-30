import { z } from 'zod'

// https://datatracker.ietf.org/doc/html/rfc8252#section-7.3
export const DESKTOP_REDIRECT_URI_PATTERN =
  /^http:\/\/127\.0\.0\.1:\d{1,5}\/desktop\/auth\/callback$/

// https://datatracker.ietf.org/doc/html/rfc7636#section-4.1
export const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/

// https://datatracker.ietf.org/doc/html/rfc7636#section-4.2 (S256 of a 32-byte hash, unpadded base64url)
export const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/

const redirectUriSchema = z.string().regex(DESKTOP_REDIRECT_URI_PATTERN)

export const authorizeDesktopInputSchema = z.strictObject({
  redirectUri: redirectUriSchema,
  codeChallenge: z.string().regex(CODE_CHALLENGE_PATTERN),
  codeChallengeMethod: z.literal('S256'),
})
export type AuthorizeDesktopInput = z.infer<typeof authorizeDesktopInputSchema>

export const authorizeDesktopReplySchema = z.strictObject({
  code: z.string().min(1),
})
export type AuthorizeDesktopReply = z.infer<typeof authorizeDesktopReplySchema>

export const exchangeDesktopCodeInputSchema = z.strictObject({
  code: z.string().min(1).max(256),
  codeVerifier: z.string().regex(CODE_VERIFIER_PATTERN),
  redirectUri: redirectUriSchema,
})
export type ExchangeDesktopCodeInput = z.infer<typeof exchangeDesktopCodeInputSchema>

export const exchangeDesktopCodeReplySchema = z.strictObject({
  token: z.string().min(1),
})
export type ExchangeDesktopCodeReply = z.infer<typeof exchangeDesktopCodeReplySchema>
