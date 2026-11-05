import { randomBytes } from 'node:crypto'

import type { StoredTokens } from './oauth-types'

const MAX_REFRESH_SKEW_MS = 5 * 60_000
const SKEW_FRACTION = 0.1
const USABLE_MARGIN_MS = 15_000
export const STALE_ATTEMPT_MS = 30_000

export const newAttemptId = (): string => randomBytes(16).toString('hex')

const skewOf = (tokens: StoredTokens): number => {
  const lifetime = Date.parse(tokens.expiresAt) - Date.parse(tokens.issuedAt)
  return Math.min(MAX_REFRESH_SKEW_MS, Math.max(0, lifetime) * SKEW_FRACTION)
}

export const refreshAfterMs = (tokens: StoredTokens): number =>
  Date.parse(tokens.expiresAt) - skewOf(tokens)

export const isDue = (args: { tokens: StoredTokens; nowMs: number }): boolean =>
  args.nowMs >= refreshAfterMs(args.tokens)

export const isUsable = (args: { tokens: StoredTokens; nowMs: number }): boolean =>
  Date.parse(args.tokens.expiresAt) - args.nowMs > USABLE_MARGIN_MS
