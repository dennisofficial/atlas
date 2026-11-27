import { FRESH_MARGIN_MS, STALE_ATTEMPT_MS } from './gateway-timing'
import type { McpOauthGrant, McpServerGrantRow, OAuthTokens } from './types'

export const freshTokensOf = (args: { tokens: OAuthTokens; now: number }): boolean => {
  const expiresAt = args.tokens.expiresAt
  return expiresAt === undefined || Date.parse(expiresAt) > args.now + FRESH_MARGIN_MS
}

export const attemptLiveOf = (args: { row: McpServerGrantRow; now: number }): boolean => {
  if (args.row.oauthRefreshAttempt === null) return false
  const startedMs = args.row.oauthRefreshStartedAt?.getTime() ?? 0
  return args.now - startedMs < STALE_ATTEMPT_MS
}

export const grantedOf = (tokens: OAuthTokens): McpOauthGrant => ({
  ok: true,
  accessToken: tokens.accessToken,
  expiresAt: tokens.expiresAt ?? null,
})
