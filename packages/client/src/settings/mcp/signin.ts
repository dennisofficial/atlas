import { EMcpOauthBeginOutcome, type McpOauthScreen } from '@dltech/atlas-wire/web'

export type McpSignInScreen = McpOauthScreen

export type McpSignInResult = { ok: true; url: string } | { ok: false; reason: string }

export const UNREACHABLE_SIGN_IN = 'the api could not begin the sign-in'

export const unreachableSignInResult = (): McpSignInResult => ({
  ok: false,
  reason: UNREACHABLE_SIGN_IN,
})

export const mcpSignInResultOf = (answer: {
  outcome: EMcpOauthBeginOutcome
  authorizationUrl?: string | undefined
  reason?: string | undefined
}): McpSignInResult =>
  answer.outcome === EMcpOauthBeginOutcome.Redirect && answer.authorizationUrl !== undefined
    ? { ok: true, url: answer.authorizationUrl }
    : { ok: false, reason: answer.reason ?? UNREACHABLE_SIGN_IN }
